/**
 * TokenTracker — 精确基准 + 粗估增量的 Token 跟踪器
 *
 * 设计思路：
 * - 每次 API 调用返回时，用 usage.prompt_tokens（精确值）校准基准
 * - 中间新增的消息用 chars/4 粗估补上
 * - 不需要加载 tokenizer 库（如 tiktoken），精度足够做决策
 * - 误差约 10-20%，对于"要不要触发防御"这种二元判断完全够用
 *
 * 使用方式：
 * ```
 * const tracker = new TokenTracker()
 *
 * // 每次 API 返回后校准
 * tracker.updateFromAPI(usage.inputTokens)
 *
 * // 新增消息时记录
 * tracker.addMessage("用户的新问题...")
 *
 * // 获取估算值
 * const currentTokens = tracker.estimatedTokens
 * ```
 */

import { estimateTokensFromChars, estimateMessageTokens, getTotalCharCount } from './token-estimator'
import type { ModelMessage } from 'ai'

// ─── 配置 ────────────────────────────────────────────────────────────────────

/** 估算 token 的误差范围（用于日志提示） */
const ESTIMATION_ERROR_RANGE = 0.2 // ±20%

// ─── TokenTracker ─────────────────────────────────────────────────────────────

export class TokenTracker {
  /** 上次 API 返回的精确 prompt token 数 */
  private lastPreciseCount = 0

  /** 自上次校准后新增消息的累计字符数 */
  private pendingChars = 0

  /** 上次校准时间（用于日志） */
  private lastCalibratedAt: number | null = null

  /**
   * 用 API 返回的精确值校准。
   * 调用时机：每次 streamText 的 finish chunk 返回 usage.inputTokens 时。
   *
   * @param promptTokens - API 返回的 prompt_tokens（精确值）
   */
  updateFromAPI(promptTokens: number): void {
    this.lastPreciseCount = promptTokens
    this.pendingChars = 0
    this.lastCalibratedAt = Date.now()
  }

  /**
   * 记录新增消息的字符数。
   * 调用时机：每次有新的 user/assistant/tool 消息追加到上下文时。
   *
   * @param content - 新增消息的文本内容
   */
  addMessage(content: string): void {
    this.pendingChars += content.length
  }

  /**
   * 记录新增消息列表（批量）。
   * 遍历消息列表计算字符数并累加到 pendingChars。
   *
   * @param messages - 新增的消息列表
   */
  addMessages(messages: ModelMessage[]): void {
    this.pendingChars += getTotalCharCount(messages)
  }

  /**
   * 获取当前估算的 token 数。
   *
   * 公式：精确基准 + ceil(增量字符数 / 4 * 1.2)
   * 返回的是带安全系数的估算值。
   */
  get estimatedTokens(): number {
    const estimatedIncrement = estimateTokensFromChars(this.pendingChars)
    return this.lastPreciseCount + estimatedIncrement
  }

  /**
   * 获取精确基准（上次 API 返回的值）。
   */
  get preciseCount(): number {
    return this.lastPreciseCount
  }

  /**
   * 获取增量估算的 token 数。
   */
  get estimatedIncrement(): number {
    return estimateTokensFromChars(this.pendingChars)
  }

  /**
   * 获取上次校准距今的毫秒数。
   */
  get timeSinceCalibration(): number | null {
    if (this.lastCalibratedAt === null) return null
    return Date.now() - this.lastCalibratedAt
  }

  /**
   * 获取估算的误差范围描述（用于日志）。
   */
  get errorRange(): string {
    const lower = Math.floor(this.estimatedTokens * (1 - ESTIMATION_ERROR_RANGE))
    const upper = Math.ceil(this.estimatedTokens * (1 + ESTIMATION_ERROR_RANGE))
    return `${lower} - ${upper}`
  }

  /**
   * 判断当前估算是否可能超过某个阈值。
   * 使用估算值上界做保守判断，避免漏报。
   *
   * @param threshold - token 阈值
   * @returns 是否可能超过阈值
   */
  mayExceed(threshold: number): boolean {
    return this.estimatedTokens * (1 + ESTIMATION_ERROR_RANGE) >= threshold
  }

  /**
   * 重置跟踪器。
   */
  reset(): void {
    this.lastPreciseCount = 0
    this.pendingChars = 0
    this.lastCalibratedAt = null
  }

  /**
   * 导出当前状态（用于持久化或调试）。
   */
  getSnapshot(): TokenTrackerSnapshot {
    return {
      lastPreciseCount: this.lastPreciseCount,
      pendingChars: this.pendingChars,
      estimatedTokens: this.estimatedTokens,
      lastCalibratedAt: this.lastCalibratedAt,
    }
  }
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface TokenTrackerSnapshot {
  lastPreciseCount: number
  pendingChars: number
  estimatedTokens: number
  lastCalibratedAt: number | null
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/**
 * 创建一个 TokenTracker 并用初始消息列表初始化。
 * 初始消息会被记录为 pending（因为还没调过 API）。
 *
 * @param initialMessages - 初始消息列表
 */
export function createTokenTracker(initialMessages?: ModelMessage[]): TokenTracker {
  const tracker = new TokenTracker()
  if (initialMessages && initialMessages.length > 0) {
    tracker.addMessages(initialMessages)
  }
  return tracker
}
