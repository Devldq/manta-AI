/**
 * Compaction — LLM 摘要压缩，将超长对话历史压缩为结构化摘要
 *
 * 设计思路：
 * - 当消息列表 token 数超过阈值时，触发 LLM 摘要压缩
 * - 保留最近 N 条消息不动，对更早的消息进行压缩
 * - 切分点对齐到 user 消息边界（避免非 user 开头的消息列表）
 * - 已有摘要会合并到新一轮压缩中（累积式摘要）
 * - 压缩后的摘要以 user 角色注入消息列表最前面
 *
 * 与 Microcompact 的关系：
 * - Microcompact：轻量级清理，只替换旧工具结果为占位符，不调 LLM
 * - Compaction：重量级压缩，调用 LLM 生成结构化摘要，大幅减少 token
 * - 两者互补：Microcompact 每步执行，Compaction 在 token 超阈值时触发
 */

import type { ModelMessage } from 'ai'
import { generateText } from 'ai'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { logger } from '@/core/log'
import { estimateTokensFromChars, getMessageCharCount } from './token-estimator'

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/**
 * 触发压缩的 token 阈值。
 * 当消息列表估算 token 数超过此值时，触发 LLM 摘要压缩。
 */
const COMPACTION_TOKEN_THRESHOLD = 60000

/**
 * 保留最近 N 条消息不压缩。
 * 这些消息是模型最近看到的上下文，必须原样保留以保证对话连贯性。
 */
const KEEP_RECENT_MESSAGES = 10

/**
 * 压缩摘要最大长度（字符数），防止摘要本身过长。
 */
const MAX_SUMMARY_LENGTH = 800

// ─── 压缩 Prompt ──────────────────────────────────────────────────────────────

/**
 * LLM 摘要压缩的系统提示词。
 *
 * 三个核心设计原则：
 * 1. **保什么** — 结构化模板，每个字段必填，不让模型自由发挥
 * 2. **不保什么** — 不要笼统概述，只保留具体的、可操作的信息
 * 3. **标识符保护** — 文件路径、UUID、版本号等不能被"翻译"或改写
 */
const COMPRESS_PROMPT = `你是一个对话压缩系统。你的任务是把 Agent 和用户之间的对话历史压缩成一份结构化摘要，确保后续对话能够无缝继续。

请严格按照以下模板输出，每个字段都要填写：

## 用户意图
（用户在这次对话中想要完成什么）

## 已完成的操作
（Agent 执行了哪些工具调用、产生了什么结果）

## 关键发现
（读取的文件内容要点、搜索结果、命令输出中的关键信息）

## 当前状态
（对话进行到哪一步了、还有什么没做完）

## 需要保留的细节
（文件路径、变量名、配置值、错误信息等不能丢失的具体内容）

注意事项：
- 用对话中使用的语言输出
- 文件路径、UUID、版本号等标识符必须原样保留，不要翻译或改写
- 不要写笼统的概述，只保留具体的、可操作的信息
- 总长度控制在 800 字以内`

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 压缩结果 */
export interface CompactionResult {
  /** 压缩后的消息列表（摘要 + 保留的最近消息） */
  messages: ModelMessage[]
  /** 当前摘要文本（用于下次压缩时合并） */
  summary: string
  /** 本次被压缩掉的消息数 */
  compressedCount: number
}

// ─── Token 估算 ───────────────────────────────────────────────────────────────

/**
 * 估算消息列表的 token 数。
 *
 * 统一使用 token-estimator 中的 estimateMessageTokens，公式为 chars/4 * 1.2（中文安全系数）。
 * 这不是精确计算，仅用于判断是否触发压缩，精度要求不高。
 *
 * @param messages - 消息列表
 * @returns 估算的 token 数
 */
export function estimateTokens(messages: ModelMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokensFromChars(getMessageCharCount(msg))
  }
  return total
}

// ─── 消息格式化 ───────────────────────────────────────────────────────────────

/**
 * 将消息列表格式化为可供 LLM 阅读的对话文本。
 */
function formatMessagesForCompression(messages: ModelMessage[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = msg.role
    const content = typeof msg.content === 'string'
      ? msg.content
      : formatContentParts(msg.content)

    // 截断过长的单条消息内容
    const truncated = content.length > 3000
      ? content.slice(0, 3000) + '\n... [内容已截断]'
      : content

    lines.push(`[${role}]: ${truncated}`)
  }
  return lines.join('\n\n')
}

/**
 * 格式化 content parts（AI SDK 的多部分内容格式）。
 */
function formatContentParts(parts: unknown): string {
  if (!Array.isArray(parts)) return String(parts)

  return parts
    .map((part: unknown) => {
      if (!part || typeof part !== 'object') return String(part)

      const p = part as Record<string, unknown>
      switch (p.type) {
        case 'text':
          return p.text as string
        case 'tool-call':
          return `[调用工具: ${p.toolName}] 参数: ${JSON.stringify(p.input)}`
        case 'tool-result':
          return `[工具结果: ${p.toolName}] ${JSON.stringify(p.output)}`
        default:
          return JSON.stringify(part).slice(0, 200)
      }
    })
    .join('\n')
}

// ─── 对齐逻辑 ────────────────────────────────────────────────────────────────

/**
 * 找到消息切分点，确保切分后保留的消息以 user 角色开头。
 *
 * 很多 LLM API 要求消息列表以 user 消息开头（或 system 后跟 user），
 * 如果切分后第一条是 assistant 或 tool 消息，API 会报错。
 *
 * 从切分点往前扫描，找到最近的 user 消息作为真正的切分点。
 *
 * @param messages - 完整消息列表
 * @param splitIdx - 初始切分索引（保留从这里开始的消息）
 * @returns 对齐后的切分索引（确保 messages[result] 是 user 消息）
 */
function alignToUserBoundary(messages: ModelMessage[], splitIdx: number): number {
  for (let i = splitIdx - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return i
    }
  }
  // 如果前面没有 user 消息（极端情况），返回原始切分点
  return splitIdx
}

// ─── 核心压缩逻辑 ─────────────────────────────────────────────────────────────

/**
 * 执行 LLM 摘要压缩。
 *
 * @param model - AI 模型实例（通过 getAISDKModel 获取）
 * @param messages - 当前完整消息列表
 * @param existingSummary - 上一次压缩的摘要（如果有，会合并到本次压缩中）
 * @returns 压缩结果
 */
export async function compactMessages(
  messages: ModelMessage[],
  existingSummary?: string,
): Promise<CompactionResult> {
  const tokenEstimate = estimateTokens(messages)

  // 未达到阈值，不需要压缩
  if (tokenEstimate < COMPACTION_TOKEN_THRESHOLD) {
    return { messages, summary: existingSummary ?? '', compressedCount: 0 }
  }

  // 计算切分点：保留最近 KEEP_RECENT_MESSAGES 条消息
  const splitIdx = Math.max(0, messages.length - KEEP_RECENT_MESSAGES)

  // 对齐到 user 消息边界
  const alignedIdx = alignToUserBoundary(messages, splitIdx)

  const toCompress = messages.slice(0, alignedIdx)
  const toKeep = messages.slice(alignedIdx)

  if (toCompress.length === 0) {
    logger.warn('[Compaction] 无可压缩消息（对齐后压缩段为空）', {
      extra: {
        totalMessages: messages.length,
        splitIdx,
        alignedIdx,
        keepCount: toKeep.length,
      },
    }, ['agent', 'compaction'])
    return { messages, summary: existingSummary ?? '', compressedCount: 0 }
  }

  // 格式化被压缩的消息为对话文本
  const conversationText = formatMessagesForCompression(toCompress)

  // 如果有上一次的摘要，合并进去一起压缩（累积式摘要）
  const userPrompt = existingSummary
    ? `## 已有摘要\n\n${existingSummary}\n\n## 新对话\n\n${conversationText}`
    : conversationText

  logger.info(
    `[Compaction] 开始压缩 · ${toCompress.length}条消息 · 保留${toKeep.length}条 · ` +
    `估算 ~${tokenEstimate} tokens`,
    {
      extra: {
        compressCount: toCompress.length,
        keepCount: toKeep.length,
        estimatedTokens: tokenEstimate,
        hasExistingSummary: !!existingSummary,
        threshold: COMPACTION_TOKEN_THRESHOLD,
      },
    },
    ['agent', 'compaction'],
  )

  try {
    const model = await getAISDKModel()

    const { text: summary } = await generateText({
      model,
      system: COMPRESS_PROMPT,
      prompt: userPrompt,
      maxOutputTokens: 1000,
      temperature: 0.3, // 低温度，确保输出稳定、忠于原文
    })

    const trimmedSummary = summary.length > MAX_SUMMARY_LENGTH
      ? summary.slice(0, MAX_SUMMARY_LENGTH) + '\n\n... [摘要已截断]'
      : summary

    // 摘要作为 user 消息注入到消息列表最前面
    const summaryMessage: ModelMessage = {
      role: 'user',
      content: `[以下是之前对话的压缩摘要]\n\n${trimmedSummary}\n\n[摘要结束]`,
    }

    logger.info(
      `[Compaction] 压缩完成 · 摘要 ${trimmedSummary.length} 字 · ` +
      `压缩 ${toCompress.length} 条消息`,
      {
        extra: {
          summaryLength: trimmedSummary.length,
          compressedCount: toCompress.length,
          keptCount: toKeep.length,
          estimatedSavedTokens: estimateTokens(toCompress) - estimateTokens([summaryMessage]),
        },
      },
      ['agent', 'compaction'],
    )

    return {
      messages: [summaryMessage, ...toKeep],
      summary: trimmedSummary,
      compressedCount: toCompress.length,
    }
  } catch (err) {
    logger.error('[Compaction] 压缩失败，回退到未压缩消息', err instanceof Error ? err : new Error(String(err)), {
      extra: {
        compressCount: toCompress.length,
        keepCount: toKeep.length,
      },
    }, ['agent', 'compaction', 'error'])

    // 压缩失败时回退：保留原始消息，不做压缩
    return { messages, summary: existingSummary ?? '', compressedCount: 0 }
  }
}

/**
 * 带日志的 Compaction 包装函数。
 *
 * 在 agent loop 中调用，输出结构化日志便于追踪压缩效果。
 *
 * @param messages - 当前消息列表
 * @param conversationId - 会话 ID
 * @param messageId - 消息 ID
 * @param stepIndex - 当前步数
 * @param existingSummary - 已有摘要
 * @returns 压缩结果
 */
export async function compactMessagesWithLogging(
  messages: ModelMessage[],
  conversationId?: string,
  messageId?: string,
  stepIndex?: number,
  existingSummary?: string,
): Promise<CompactionResult> {
  const startTime = performance.now()

  const result = await compactMessages(messages, existingSummary)

  if (result.compressedCount > 0) {
    const durationMs = Math.round(performance.now() - startTime)
    logger.info(
      `[Compaction] 完成 · 压缩${result.compressedCount}条 · ${durationMs}ms · ` +
      `摘要${result.summary.length}字`,
      {
        conversationId,
        messageId,
        stepIndex,
        durationMs,
        extra: {
          compressedCount: result.compressedCount,
          summaryLength: result.summary.length,
          keptCount: result.messages.length - 1, // 减去 summary 消息
          durationMs,
        },
      },
      ['agent', 'loop', 'compaction'],
    )
  }

  return result
}
