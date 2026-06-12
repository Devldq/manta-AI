/**
 * Truncate Tool Results — 动态工具结果截断（Layer 2）
 *
 * 设计思路：
 * - Layer 1（静态截断）：注册时配置的 maxResultChars（默认 3000），在 registry.ts 的
 *   buildAISDKTools 中由 truncateResult 执行，固定 Head/Tail 60/40 分割。
 * - Layer 2（动态截断）：根据当前上下文使用率实时调整截断阈值，在 agent-loop 中每步执行。
 * - 双重约束（对齐 OpenClaw）：
 *   1. Pass 1 — 单条截断：单个工具结果不超过上下文窗口的 50%（以 chars 计）
 *   2. Pass 2 — 总量预算：如果总字符数超过窗口 75%，从最老的 tool result 开始逐条 compact
 *
 * 为什么是 Head/Tail 60/40 而不是只保留头部？
 * - 文件尾部的信息往往比中间更有价值：日志文件的最新条目在尾部，代码文件的函数实现在尾部，
 *   命令输出的结论在尾部。只截头部会丢掉这些关键信息。
 * - 截断标记 [truncated: 80000 → 50000 chars] 告诉模型"这里有内容被截掉了"，
 *   模型可以根据需要重新读取完整内容。不加标记模型可能以为它看到的就是全部。
 *
 * 与其他机制的关系：
 * - Microcompact：把旧的查询类工具结果替换为占位符（不分内容，全替换）
 * - truncateToolResults：对剩余的工具结果做 Head/Tail 截断（保留信息，只缩量）
 * - Compaction：LLM 摘要压缩（最重量的手段）
 * - 执行顺序：Microcompact → truncateToolResults → Compaction
 */

import type { ModelMessage } from 'ai'
import { getTotalCharCount, getMessageCharCount } from '../token/estimator'
import { logger } from '@observability/log'

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/** 上下文窗口大小（token），对齐当前主流模型 200K 上下文 */
const CONTEXT_WINDOW = 200_000

/**
 * 单条工具结果最大字符数。
 * 窗口 50% = 100K tokens，按 2 chars/token（较保守的估算）≈ 200K chars。
 * 用 2 chars/token 比 4 chars/token 更保守，确保单条结果不会太大。
 */
const MAX_SINGLE_RESULT_CHARS = CONTEXT_WINDOW * 0.5 * 2 // ≈ 200,000 chars

/**
 * 总上下文字符预算。
 * 窗口 75% = 150K tokens，按 4 chars/token（较宽松的估算）≈ 600K chars。
 * 用 4 chars/token 给更多空间，避免误杀。
 */
const CONTEXT_BUDGET_CHARS = CONTEXT_WINDOW * 0.75 * 4 // ≈ 600,000 chars

/** Head/Tail 分割比例 */
const HEAD_RATIO = 0.6
const TAIL_RATIO = 0.4

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 截断结果统计 */
export interface TruncateResult {
  /** 处理后的消息列表 */
  messages: ModelMessage[]
  /** Pass 1 被截断的工具结果数 */
  truncated: number
  /** Pass 2 被 compact 的工具结果数 */
  compacted: number
  /** 截断前总字符数 */
  totalCharsBefore: number
  /** 截断后总字符数 */
  totalCharsAfter: number
}

/** 截断配置（可选覆盖默认值） */
export interface TruncateConfig {
  maxSingleResult?: number
  contextBudgetChars?: number
}

// ─── 核心逻辑 ────────────────────────────────────────────────────────────────

/**
 * 对消息列表执行双重约束的动态工具结果截断。
 *
 * Pass 1：单条截断 — 超过窗口 50% 的工具结果做 Head/Tail 分割
 * Pass 2：总量预算 — 如果总字符数仍超过 75%，从最老的 tool result 开始逐条 compact
 *
 * @param messages - 当前消息列表
 * @param config - 可选截断配置
 * @returns 截断结果（新消息列表 + 统计信息）
 */
export function truncateToolResults(
  messages: ModelMessage[],
  config: TruncateConfig = {},
): TruncateResult {
  const maxSingleResult = config.maxSingleResult ?? MAX_SINGLE_RESULT_CHARS
  const contextBudgetChars = config.contextBudgetChars ?? CONTEXT_BUDGET_CHARS

  let truncated = 0
  let compacted = 0
  const totalCharsBefore = getTotalCharCount(messages)

  // ── Pass 1：单条截断 ────────────────────────────────────────────────────
  // 遍历所有消息，对超过单条上限的工具结果做 Head/Tail 分割
  const pass1Messages = messages.map((msg) => {
    if (msg.role !== 'tool' || !Array.isArray(msg.content)) return msg

    const newContent = msg.content.map((part: any) => {
      // 跳过非 tool-result 的 content part
      if (!part || typeof part !== 'object') return part
      if ((part as { type?: string }).type !== 'tool-result') return part

      // 获取 output 的实际文本内容
      const output = part.output
      const outputText = getOutputText(output)

      if (!outputText || outputText.length <= maxSingleResult) return part

      truncated++

      // Head/Tail 60/40 分割
      const headSize = Math.floor(maxSingleResult * HEAD_RATIO)
      const tailSize = Math.floor(maxSingleResult * TAIL_RATIO)
      const head = outputText.slice(0, headSize)
      const tail = outputText.slice(-tailSize)

      // 构建新的 output：保持原有的 output 结构
      const newOutput = buildOutputValue(
        output,
        `${head}\n\n[truncated: ${outputText.length} → ${maxSingleResult} chars]\n\n${tail}`,
      )

      return { ...part, output: newOutput }
    })

    return { ...msg, content: newContent }
  })

  // ── Pass 2：总量预算 ────────────────────────────────────────────────────
  // 如果总字符数仍超过 75% 窗口预算，从最老的 tool result 开始逐条 compact
  let result = pass1Messages
  let totalChars = getTotalCharCount(pass1Messages)

  if (totalChars > contextBudgetChars) {
    for (let i = 0; i < result.length && totalChars > contextBudgetChars; i++) {
      const msg = result[i]
      if (msg.role !== 'tool' || !Array.isArray(msg.content)) continue

      // 检查是否已经是 compacted 状态（避免重复 compact）
      const alreadyCompacted = msg.content.some((p: any) => {
        if (!p || typeof p !== 'object') return false
        return (p.output?.value as string)?.startsWith('[compacted:') ?? false
      })
      if (alreadyCompacted) continue

      // 计算旧大小并替换为 compact 占位符
      const toolName = extractToolName(msg)
      const oldSize = getMessageCharCount(msg)

      const newContent = msg.content.map((p: any) => {
        if (!p || typeof p !== 'object') return p
        if ((p as { type?: string }).type !== 'tool-result') return p
        const newOutput = buildOutputValue(
          p.output,
          `[compacted: ${toolName} output removed to free context]`,
        )
        return { ...p, output: newOutput }
      })

      result[i] = { ...msg, content: newContent }
      totalChars -= oldSize
      compacted++
    }
  }

  const totalCharsAfter = getTotalCharCount(result)

  return {
    messages: result,
    truncated,
    compacted,
    totalCharsBefore,
    totalCharsAfter,
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从 output 中提取纯文本内容。
 * 处理 AI SDK v6 的多种 output 格式：{ type: 'text', value: string } | { type: 'json', value: object } 等。
 */
function getOutputText(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    const o = output as Record<string, unknown>
    if (o.value !== undefined) {
      return typeof o.value === 'string' ? o.value : JSON.stringify(o.value)
    }
    return JSON.stringify(output)
  }
  return null
}

/**
 * 根据原始 output 结构，构建新的 output 值。
 * 保持 AI SDK v6 的 discriminatedUnion 格式。
 */
function buildOutputValue(originalOutput: unknown, newText: string): unknown {
  if (originalOutput && typeof originalOutput === 'object') {
    const o = originalOutput as Record<string, unknown>
    if ('type' in o) {
      // 保持原有 type 结构，替换 value
      if (o.type === 'text' || o.type === 'error-text') {
        return { type: o.type, value: newText }
      }
      if (o.type === 'json') {
        return { type: 'text', value: newText }
      }
      return { type: 'text', value: newText }
    }
  }
  return { type: 'text', value: newText }
}

/**
 * 从 tool 消息中提取工具名。
 */
function extractToolName(msg: ModelMessage): string {
  if (!Array.isArray(msg.content)) return 'unknown'
  for (const part of msg.content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: string }).type === 'tool-result'
    ) {
      return (part as { toolName?: string }).toolName ?? 'unknown'
    }
  }
  return 'unknown'
}

// ─── 带日志的包装函数 ────────────────────────────────────────────────────────

/**
 * 带日志的截断包装函数。
 *
 * 在 agent loop 中调用，输出结构化日志便于追踪截断效果。
 *
 * @param messages - 当前消息列表
 * @param conversationId - 会话 ID
 * @param messageId - 消息 ID
 * @param stepIndex - 当前步数
 * @param config - 可选截断配置
 * @returns 截断结果
 */
export function truncateToolResultsWithLogging(
  messages: ModelMessage[],
  conversationId?: string,
  messageId?: string,
  stepIndex?: number,
  config?: TruncateConfig,
): TruncateResult {
  const result = truncateToolResults(messages, config)

  if (result.truncated > 0 || result.compacted > 0) {
    const savedChars = result.totalCharsBefore - result.totalCharsAfter
    logger.info(
      `[Truncate] 完成 · Pass1截断${result.truncated}条 · Pass2清理${result.compacted}条 · ` +
      `节省${savedChars}字符(${result.totalCharsBefore}→${result.totalCharsAfter})`,
      {
        conversationId,
        messageId,
        stepIndex,
        extra: {
          truncated: result.truncated,
          compacted: result.compacted,
          totalCharsBefore: result.totalCharsBefore,
          totalCharsAfter: result.totalCharsAfter,
          savedChars,
          config: {
            maxSingleResult: config?.maxSingleResult ?? MAX_SINGLE_RESULT_CHARS,
            contextBudgetChars: config?.contextBudgetChars ?? CONTEXT_BUDGET_CHARS,
          },
        },
      },
      ['agent', 'loop', 'truncate'],
    )
  }

  return result
}
