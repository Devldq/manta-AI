/**
 * Agent 运行指标类型定义
 *
 * 覆盖三个维度：
 * 1. 基础运行指标：TTFT、延迟、Token、请求/错误数
 * 2. Agent 执行质量：工具选择正确性、工具调用成功率、循环/步数
 * 3. 成本与资源：Token 消耗、缓存命中率
 */

// ─── 单步指标 ──────────────────────────────────────────────────────

/** 单步 token 用量（含缓存明细） */
export interface StepTokenUsage {
  inputTokens: number
  outputTokens: number
  /** 缓存命中读取的 token 数 */
  cacheReadTokens?: number
  /** 缓存写入的 token 数 */
  cacheWriteTokens?: number
  /** 非缓存输入 token 数 */
  noCacheTokens?: number
}

/** 单步性能计时 */
export interface StepTiming {
  /** 本步耗时（毫秒） */
  durationMs: number
  /** 首字延迟（毫秒），仅第一步有意义 */
  ttftMs?: number
  /** 工具调用总耗时（毫秒） */
  toolDurationMs?: number
}

/** 单步结果摘要 */
export interface StepMetrics {
  stepIndex: number
  /** 工具调用名称列表 */
  toolNames: string[]
  /** 工具调用总数 */
  toolCallCount: number
  /** 工具调用错误数 */
  toolErrorCount: number
  /** 是否有文本输出 */
  hasText: boolean
  /** 文本输出长度 */
  textLength: number
  /** 结束原因 */
  finishReason: string
  /** Token 用量 */
  usage: StepTokenUsage
  /** 性能计时 */
  timing: StepTiming
}

// ─── 单轮（Turn）指标 ──────────────────────────────────────────────

/** 单轮对话的完整指标快照 */
export interface TurnMetrics {
  /** 对话轮次 ID */
  messageId: string
  /** 会话 ID */
  conversationId: string
  /** 用户 prompt 摘要（截断到 80 字符） */
  prompt: string

  // 基础运行指标
  /** 总耗时（毫秒） */
  totalDurationMs: number
  /** 首字延迟（毫秒） */
  ttftMs: number
  /** 步数 */
  totalSteps: number

  // Token 指标
  /** 总输入 token */
  totalInputTokens: number
  /** 总输出 token */
  totalOutputTokens: number
  /** 总 token 消耗 */
  totalTokens: number
  /** 缓存命中 token */
  cacheReadTokens: number
  /** 缓存写入 token */
  cacheWriteTokens: number
  /** 缓存命中率 */
  cacheHitRate: number

  // 工具指标
  /** 工具调用总数 */
  totalToolCalls: number
  /** 工具调用成功数 */
  toolCallSuccessCount: number
  /** 工具调用失败数 */
  toolCallErrorCount: number
  /** 工具调用成功率 */
  toolCallSuccessRate: number

  // Agent 执行质量
  /** 循环检测触发次数 */
  loopDetectionCount: number
  /** 退出原因 */
  stopReason: string
  /** 各步骤明细 */
  steps: StepMetrics[]
  /** 模型信息 */
  model?: string
  provider?: string
}

// ─── 会话聚合指标 ──────────────────────────────────────────────────

/** 会话级别的聚合指标 */
export interface SessionMetrics {
  conversationId: string
  /** 总轮数 */
  totalTurns: number
  /** 总耗时（毫秒） */
  totalDurationMs: number
  /** 平均 TTFT（毫秒） */
  avgTtftMs: number
  /** 总步数 */
  totalSteps: number
  /** 总 token */
  totalTokens: number
  /** 总输入 token */
  totalInputTokens: number
  /** 总输出 token */
  totalOutputTokens: number
  /** 缓存命中率 */
  cacheHitRate: number
  /** 总工具调用数 */
  totalToolCalls: number
  /** 工具调用成功率 */
  toolCallSuccessRate: number
  /** 错误轮次数 */
  errorTurns: number
  /** Agent 名称 */
  agentName?: string
  /** 各轮次明细 */
  turns: TurnMetrics[]
}

// ─── 工具使用指标 ──────────────────────────────────────────────────

/** 单个工具的使用统计 */
export interface ToolUsageMetrics {
  toolName: string
  /** 调用次数 */
  callCount: number
  /** 成功次数 */
  successCount: number
  /** 失败次数 */
  errorCount: number
  /** 成功率 */
  successRate: number
  /** 平均耗时（毫秒） */
  avgDurationMs: number
  /** 总耗时（毫秒） */
  totalDurationMs: number
}
