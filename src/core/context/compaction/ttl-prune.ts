/**
 * TTL 修剪 — 时间衰减（Layer 3）
 *
 * 设计思路：
 * - Layer 1（Microcompact）：白名单清理旧查询工具结果
 * - Layer 2（Truncate Tool Results）：动态截断，Head/Tail 60/40 分割 + 总量预算
 * - Layer 3（TTL 修剪）：按消息年龄做时间衰减，老的工具结果自动退化
 *
 * 核心洞察：老的工具结果几乎一定比新的更没用。
 * 5 分钟前读的文件内容，大概率已经不影响当前决策了。
 * 但直接删掉又会破坏对话结构。
 *
 * TTL 修剪分两档：
 * - 软修剪（5 分钟）— 保留 Head/Tail 各 1500 字符，中间替换成 [soft pruned] 标记
 * - 硬清除（10 分钟）— 整个工具结果替换成 [tool result expired: toolName]
 *
 * 铁律：
 * - 只修剪 tool 结果，user/assistant 消息永不修剪
 * - 保留错误经验 — 失败的工具结果（error、失败、不存在 等）不修剪
 * - 模型知道"第 N 轮调用了某个工具"，只是看不到内容，需要时可以再读
 */

import type { ModelMessage } from 'ai'
import { getMessageCharCount, estimateTokensFromChars } from '../token/estimator'
import { logger } from '@observability/log'

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/** 软修剪阈值（毫秒），默认 5 分钟 */
const DEFAULT_SOFT_TTL_MS = 5 * 60_000

/** 硬清除阈值（毫秒），默认 10 分钟 */
const DEFAULT_HARD_TTL_MS = 10 * 60_000

/** 软修剪保留的 Head/Tail 字符数 */
const DEFAULT_KEEP_HEAD_TAIL = 1500

// ─── 错误关键词（不修剪这些工具结果） ───────────────────────────────────────

/**
 * 错误关键词集合。
 * 工具结果中包含这些词的，说明工具调用失败了，
 * 模型需要记住"这条路走不通"，否则会重复尝试同样的错误操作。
 */
const ERROR_KEYWORDS = /error|失败|不存在|denied|timeout|permission denied|not found|refused|unauthorized/i

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** TTL 修剪配置 */
export interface TTLPruneConfig {
  /** 软修剪阈值（毫秒），默认 5 分钟 */
  softTTLMs: number
  /** 硬清除阈值（毫秒），默认 10 分钟 */
  hardTTLMs: number
  /** 软修剪保留的 Head/Tail 字符数 */
  keepHeadTail: number
}

/** TTL 修剪结果 */
export interface TTLPruneResult {
  /** 处理后的消息列表 */
  messages: ModelMessage[]
  /** 软修剪的工具结果数 */
  softPruned: number
  /** 硬清除的工具结果数 */
  hardPruned: number
  /** 修剪前总字符数 */
  totalCharsBefore: number
  /** 修剪后总字符数 */
  totalCharsAfter: number
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从 tool 消息的 output 中提取纯文本内容。
 * 统一处理 AI SDK v6 的多种 output 格式。
 */
function getToolOutputText(msg: ModelMessage): string {
  if (!Array.isArray(msg.content)) return ''
  return msg.content
    .map((p: any) => {
      if (!p || typeof p !== 'object') return ''
      if (p.type !== 'tool-result') return ''
      const output = p.output
      if (typeof output === 'string') return output
      if (output && typeof output === 'object') {
        const o = output as Record<string, unknown>
        if (o.value !== undefined) {
          return typeof o.value === 'string' ? o.value : JSON.stringify(o.value)
        }
        return JSON.stringify(output)
      }
      return ''
    })
    .join('')
}

/**
 * 判断工具结果是否包含错误信息。
 * 检查 output 中是否匹配 ERROR_KEYWORDS。
 */
function isErrorResult(msg: ModelMessage): boolean {
  const text = getToolOutputText(msg)
  return ERROR_KEYWORDS.test(text)
}

/**
 * 提取工具名。
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

/**
 * 对单条工具结果消息执行软修剪。
 *
 * 保留头部和尾部各 keepHeadTail 字符，中间替换为 [soft pruned] 标记。
 * 模型还能看到文件的开头和结尾，知道"这里有过一个工具结果"。
 */
function softPruneMessage(
  msg: ModelMessage,
  keepHeadTail: number,
): ModelMessage {
  const toolName = extractToolName(msg)
  const newContent = (msg.content as any[]).map((part: any) => {
    if (!part || typeof part !== 'object' || part.type !== 'tool-result') {
      return part
    }

    const outputText = getToolOutputText(msg)

    // 内容太短不需要修剪
    if (outputText.length <= keepHeadTail * 2) return part

    const head = outputText.slice(0, keepHeadTail)
    const tail = outputText.slice(-keepHeadTail)
    const prunedText = `${head}\n\n[soft pruned: ${outputText.length - keepHeadTail * 2} chars]\n\n${tail}`

    // 构建新的 output 值，保持 AI SDK v6 的 discriminatedUnion 格式
    const originalOutput = part.output
    const newOutput = buildOutputValue(originalOutput, prunedText)

    return { ...part, output: newOutput }
  })

  return { ...msg, content: newContent }
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

// ─── 核心逻辑 ────────────────────────────────────────────────────────────────

/**
 * 对消息列表执行 TTL 时间衰减修剪。
 *
 * 只修剪 tool 结果，user/assistant 消息永不修剪。
 * 失败的工具结果（包含错误关键词）不修剪，保留错误经验。
 *
 * @param messages - 当前消息列表
 * @param timestamps - 消息索引 → 创建时间戳（毫秒）
 * @param config - TTL 配置（可选）
 * @returns 修剪结果（新消息列表 + 统计信息）
 */
export function ttlPrune(
  messages: ModelMessage[],
  timestamps: Map<number, number>,
  config: Partial<TTLPruneConfig> = {},
): TTLPruneResult {
  const softTTLMs = config.softTTLMs ?? DEFAULT_SOFT_TTL_MS
  const hardTTLMs = config.hardTTLMs ?? DEFAULT_HARD_TTL_MS
  const keepHeadTail = config.keepHeadTail ?? DEFAULT_KEEP_HEAD_TAIL
  const now = Date.now()

  const totalCharsBefore = messages.reduce(
    (sum, msg) => sum + getMessageCharCount(msg),
    0,
  )

  let softPruned = 0
  let hardPruned = 0

  const result = messages.map((msg, idx) => {
    // ── 铁律：只修剪 tool 结果，user/assistant 消息永不修剪 ──
    if (msg.role !== 'tool') return msg

    // 计算消息年龄
    const age = now - (timestamps.get(idx) ?? now)

    // ── 保留错误经验：失败的工具结果永不修剪 ──
    if (isErrorResult(msg)) return msg

    // ── 硬清除：年龄 >= 10 分钟 → 整个结果替换为过期标记 ──
    if (age >= hardTTLMs) {
      hardPruned++
      const toolName = extractToolName(msg)
      return {
        ...msg,
        content: (msg.content as any[]).map((part: any) => {
          if (!part || typeof part !== 'object' || part.type !== 'tool-result') {
            return part
          }
          const newOutput = buildOutputValue(
            part.output,
            `[tool result expired: ${toolName}]`,
          )
          return { ...part, output: newOutput }
        }),
      } as ModelMessage
    }

    // ── 软修剪：年龄 >= 5 分钟 → Head/Tail 保留，中间替换 ──
    if (age >= softTTLMs) {
      softPruned++
      return softPruneMessage(msg, keepHeadTail)
    }

    // 未达到阈值，不修剪
    return msg
  })

  const totalCharsAfter = result.reduce(
    (sum, msg) => sum + getMessageCharCount(msg),
    0,
  )

  return {
    messages: result,
    softPruned,
    hardPruned,
    totalCharsBefore,
    totalCharsAfter,
  }
}

// ─── 时间戳管理 ──────────────────────────────────────────────────────────────

/**
 * 消息时间戳管理器。
 *
 * 维护消息索引 → 创建时间戳的映射。
 * 在 appendStepToMessages 时记录新消息的时间戳。
 * 当消息被 compaction 替换时，需要更新映射。
 */
export class MessageTimestampTracker {
  /** 消息索引 → 创建时间戳（毫秒） */
  private timestamps = new Map<number, number>()

  /** 当前消息列表的长度偏移（compaction 后消息列表变短，但原始索引仍有效） */
  private offset = 0

  /**
   * 记录新消息的创建时间。
   *
   * @param startIndex - 新消息在消息列表中的起始索引
   * @param count - 新增消息数量
   */
  recordNewMessages(startIndex: number, count: number): void {
    const now = Date.now()
    for (let i = 0; i < count; i++) {
      this.timestamps.set(startIndex + i + this.offset, now)
    }
  }

  /**
   * 当 compaction 替换消息列表后，需要通知 tracker 调整偏移。
   * compaction 会将前面的 N 条消息替换为 1 条摘要，
   * 所以后面的消息索引前移了 (N - 1)。
   *
   * @param removedCount - 被移除的消息数
   * @param insertedCount - 插入的消息数（摘要通常为 1）
   */
  onCompaction(removedCount: number, insertedCount: number): void {
    const delta = removedCount - insertedCount
    this.offset += delta
  }

  /**
   * 获取当前的时间戳映射（用于传给 ttlPrune）。
   * 返回调整后的映射（考虑 compaction 偏移）。
   */
  getTimestamps(): Map<number, number> {
    return new Map(this.timestamps)
  }

  /**
   * 重置 tracker（新 loop 开始时调用）。
   */
  reset(): void {
    this.timestamps.clear()
    this.offset = 0
  }
}

// ─── 带日志的包装函数 ────────────────────────────────────────────────────────

/**
 * 带日志的 TTL 修剪包装函数。
 *
 * 在 agent loop 中调用，输出结构化日志便于追踪修剪效果。
 */
export function ttlPruneWithLogging(
  messages: ModelMessage[],
  timestamps: Map<number, number>,
  conversationId?: string,
  messageId?: string,
  stepIndex?: number,
  config?: Partial<TTLPruneConfig>,
): TTLPruneResult {
  const result = ttlPrune(messages, timestamps, config)

  if (result.softPruned > 0 || result.hardPruned > 0) {
    const savedChars = result.totalCharsBefore - result.totalCharsAfter
    logger.info(
      `[TTL Prune] 完成 · 软修剪${result.softPruned}条 · 硬清除${result.hardPruned}条 · ` +
      `节省${savedChars}字符(${result.totalCharsBefore}→${result.totalCharsAfter})`,
      {
        conversationId,
        messageId,
        stepIndex,
        extra: {
          softPruned: result.softPruned,
          hardPruned: result.hardPruned,
          totalCharsBefore: result.totalCharsBefore,
          totalCharsAfter: result.totalCharsAfter,
          savedChars,
          config: {
            softTTLMs: config?.softTTLMs ?? DEFAULT_SOFT_TTL_MS,
            hardTTLMs: config?.hardTTLMs ?? DEFAULT_HARD_TTL_MS,
            keepHeadTail: config?.keepHeadTail ?? DEFAULT_KEEP_HEAD_TAIL,
          },
        },
      },
      ['agent', 'loop', 'ttl-prune'],
    )
  }

  return result
}
