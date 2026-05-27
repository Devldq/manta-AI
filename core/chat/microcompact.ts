/**
 * Microcompact — 清理旧工具结果，减少上下文 token 占用
 *
 * 设计思路（参照 Claude Code）：
 * - 不删消息、不改对话结构，只把旧的工具结果替换成占位符
 * - 保留消息但替换内容：3000 token → [tool result cleared]（< 10 token）
 * - CLEARABLE_TOOLS 白名单：只清理"查询类"工具的结果（read_file、bash、grep 等一次性返回值）
 * - KEEP_RECENT_TOOL_RESULTS：保留最近 N 个工具结果不动（默认 3）
 *
 * 不清理的工具类型：
 * - create_issue、write_file、edit 等有副作用/产生后续依赖的工具
 * - todoWrite 等状态性工具
 * - tool_search（模型发现工具依赖其结果）
 */

import type { ModelMessage } from 'ai'
import { logger } from '@/core/log'

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/**
 * 可清理的工具名白名单（查询类/只读工具）
 *
 * 这些工具的特点：
 * - 返回值是一次性的，后续轮次不太可能再引用
 * - 没有副作用，清理不影响对话逻辑
 * - 典型例子：读文件、搜索、执行查询命令
 */
const CLEARABLE_TOOLS = new Set([
  // 文件读取类
  'read',
  'readFile',
  'read_file',
  // 目录浏览类
  'lsDir',
  'ls',
  'list_dir',
  'list_files',
  // 文件搜索类
  'glob',
  'search_file',
  // 内容搜索类
  'grep',
  'search_content',
  // Shell 命令执行（一次性输出）
  'bash',
  'execute_command',
  // 网络查询类
  'webFetch',
  'webSearch',
  'web_search',
  'web_fetch',
  // 任务查询类
  'todoRead',
  'bashOutput',
])

/**
 * 保留最近 N 个工具结果不清理。
 *
 * 最近几轮的结果很可能还在被模型引用——你刚读的文件、刚跑的命令，
 * 模型下一步可能还要用。只清理"足够老"的结果。
 */
const KEEP_RECENT_TOOL_RESULTS = 3

/**
 * 替换占位符文本。
 * 用于替换被清理的工具结果内容，确保 token 占用从上千降到个位数。
 */
const CLEARED_PLACEHOLDER = '[tool result cleared]'

// ─── 核心逻辑 ────────────────────────────────────────────────────────────────

/**
 * 判断一个工具名是否在白名单中（可清理）。
 */
export function isClearableTool(toolName: string): boolean {
  return CLEARABLE_TOOLS.has(toolName)
}

/**
 * 对消息列表执行 Microcompact 清理。
 *
 * 遍历消息列表，找到所有 tool 角色的消息（工具结果），
 * 跳过最近 KEEP_RECENT_TOOL_RESULTS 个，对其余的：
 * - 检查工具名是否在 CLEARABLE_TOOLS 白名单中
 * - 如果是，将其 content 替换为占位符
 *
 * @param messages - 当前消息列表（会被原地修改以节省内存）
 * @param keepRecent - 保留最近 N 个工具结果不动（默认 3）
 * @returns 清理统计信息
 */
export interface MicrocompactStats {
  /** 扫描到的工具结果总数 */
  totalToolResults: number
  /** 被清理的工具结果数 */
  clearedCount: number
  /** 被跳过的工具结果数（不在白名单中或最近保留的） */
  skippedCount: number
  /** 被清理的工具名列表（去重） */
  clearedTools: string[]
}

export function applyMicrocompact(
  messages: ModelMessage[],
  keepRecent: number = KEEP_RECENT_TOOL_RESULTS,
): MicrocompactStats {
  const stats: MicrocompactStats = {
    totalToolResults: 0,
    clearedCount: 0,
    skippedCount: 0,
    clearedTools: [],
  }

  // 收集所有 tool 消息的索引和工具名
  const toolMessageIndices: Array<{ index: number; toolName: string }> = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== 'tool') continue

    const content = msg.content
    if (!Array.isArray(content)) continue

    // 提取 tool-result 中的 toolName
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'tool-result'
      ) {
        const toolResult = part as { type: string; toolName?: string; toolCallId?: string }
        const toolName = toolResult.toolName ?? 'unknown'
        toolMessageIndices.push({ index: i, toolName })
        break // 每个 tool 消息只取第一个 tool-result
      }
    }
  }

  stats.totalToolResults = toolMessageIndices.length

  if (toolMessageIndices.length === 0) {
    return stats
  }

  // 跳过后面的 keepRecent 个（最近的结果保留不动）
  const skipCount = Math.min(keepRecent, toolMessageIndices.length)
  const clearable = toolMessageIndices.slice(0, toolMessageIndices.length - skipCount)

  const clearedToolNames = new Set<string>()

  for (const { index, toolName } of clearable) {
    if (!CLEARABLE_TOOLS.has(toolName)) {
      stats.skippedCount++
      continue
    }

    // 原地替换 content
    const msg = messages[index]
    if (Array.isArray(msg.content)) {
      for (let j = 0; j < msg.content.length; j++) {
        const part = msg.content[j]
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'tool-result'
        ) {
          const toolResult = part as {
            type: string
            toolName?: string
            toolCallId?: string
            output?: unknown
          }
          // 替换 output 为占位符
          toolResult.output = {
            type: 'text',
            value: CLEARED_PLACEHOLDER,
          }
          stats.clearedCount++
          clearedToolNames.add(toolName)
        }
      }
    }
  }

  // 被保留的最近 N 个结果也算 skipped
  stats.skippedCount += skipCount

  stats.clearedTools = Array.from(clearedToolNames).sort()

  return stats
}

/**
 * 预估清理节省的 token 数。
 *
 * 简化估算：每个被清理的工具结果平均节省约 500 token（基于工具结果截断为 3000 字符、平均 2.5 chars/token）。
 * 实际上，大文件读取可能节省更多（3000 token → 5 token），小结果节省更少。
 *
 * @param clearedCount - 被清理的工具结果数
 * @returns 估算节省的 token 数
 */
export function estimateSavedTokens(clearedCount: number): number {
  // 保守估计：每个工具结果平均 800 字符 ≈ 320 token
  // 替换后占位符约 20 字符 ≈ 8 token
  // 每个结果净节省 ≈ 312 token
  const AVG_TOOL_RESULT_TOKENS = 320
  const PLACEHOLDER_TOKENS = 8
  return clearedCount * (AVG_TOOL_RESULT_TOKENS - PLACEHOLDER_TOKENS)
}

/**
 * 带日志的 Microcompact 包装函数。
 *
 * 执行清理并输出结构化日志，便于追踪上下文窗口管理效果。
 *
 * @param messages - 消息列表
 * @param conversationId - 会话 ID（用于日志）
 * @param messageId - 消息 ID（用于日志）
 * @param stepIndex - 当前步数（用于日志）
 */
export function applyMicrocompactWithLogging(
  messages: ModelMessage[],
  conversationId?: string,
  messageId?: string,
  stepIndex?: number,
): MicrocompactStats {
  const stats = applyMicrocompact(messages)

  if (stats.clearedCount > 0) {
    const savedTokens = estimateSavedTokens(stats.clearedCount)
    logger.info(
      `[Microcompact] 清理完成 · ${stats.clearedCount}/${stats.totalToolResults} 个工具结果 · ` +
      `节省 ~${savedTokens} tokens · 保留最近 ${KEEP_RECENT_TOOL_RESULTS} 个`,
      {
        conversationId,
        messageId,
        stepIndex,
        extra: {
          totalToolResults: stats.totalToolResults,
          clearedCount: stats.clearedCount,
          skippedCount: stats.skippedCount,
          estimatedSavedTokens: savedTokens,
          clearedTools: stats.clearedTools,
          keepRecent: KEEP_RECENT_TOOL_RESULTS,
        },
      },
      ['agent', 'loop', 'microcompact'],
    )
  }

  return stats
}
