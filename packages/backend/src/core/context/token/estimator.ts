/**
 * Token 估算器 — 统一的 Token 数量估算工具
 *
 * 设计思路：
 * - 精确的 token 计数需要 API 返回 usage.prompt_tokens，但只有调完 API 才知道
 * - 在调 API 之前，用启发式方法快速估算，判断"要不要干预"
 * - chars/4 是业界通用方法，精度约 10-20%，足够做二元判断
 * - 中文 token 效率比英文低（1 汉字 ≈ 1.5-2 token），加 1.2x 安全系数
 *
 * 参考：
 * - 使用 chars/4 + 1.2x 中文安全系数
 * - 不同模型的 tokenizer 不同（tiktoken 加载就要几百毫秒），不适合热路径
 */

import type { ModelMessage } from 'ai'

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/** 字符/token 比例（4 个字符 ≈ 1 token） */
const CHARS_PER_TOKEN = 4

/** 中文安全系数（补偿中文 token 效率低的偏差） */
const CJK_SAFETY_FACTOR = 1.2

// ─── 单条消息估算 ────────────────────────────────────────────────────────────

/**
 * 获取单条消息的字符数。
 * 统一处理 AI SDK 的多种内容格式（string / content parts array）。
 */
export function getMessageCharCount(msg: ModelMessage): number {
  if (typeof msg.content === 'string') return msg.content.length
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum, part) => {
      if (!part || typeof part !== 'object') return sum + String(part).length
      return sum + JSON.stringify(part).length
    }, 0)
  }
  return JSON.stringify(msg.content ?? '').length
}

// ─── 核心估算函数 ────────────────────────────────────────────────────────────

/**
 * 从字符数估算 token 数。
 *
 * 公式：chars / 4 * 1.2（中文安全系数）
 * 这是整个项目唯一的估算公式，所有调用点统一使用此函数。
 *
 * @param chars - 字符数
 * @returns 估算的 token 数
 */
export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0
  return Math.ceil((chars / CHARS_PER_TOKEN) * CJK_SAFETY_FACTOR)
}

/**
 * 估算消息列表的 token 数。
 *
 * 遍历所有消息内容，累加字符数，统一用 chars/4 * 1.2 估算。
 * 注意：不包括 system prompt 的 token，仅计算消息列表。
 *
 * @param messages - 消息列表
 * @returns 估算的 token 数
 */
export function estimateMessageTokens(messages: ModelMessage[]): number {
  let totalChars = 0
  for (const msg of messages) {
    totalChars += getMessageCharCount(msg)
  }
  return estimateTokensFromChars(totalChars)
}

/**
 * 获取总字符数（不估算 token，用于原始数据记录）
 */
export function getTotalCharCount(messages: ModelMessage[]): number {
  let total = 0
  for (const msg of messages) {
    total += getMessageCharCount(msg)
  }
  return total
}
