/* AI start: 循环检测器类型定义 */

/** 工具调用指纹（用于检测重复） */
export interface ToolCallFingerprint {
  callHash: string      // 工具名+参数的哈希
  outputHash: string    // 返回结果的哈希
  toolName: string
  input: unknown
  output: unknown
  stepIndex: number     // 第几步
}

/** 循环检测结果 */
export interface LoopDetectionResult {
  type: 'none' | 'general-repeat' | 'ping-pong' | 'polling'
  severity: 'warning' | 'critical' | 'circuit-breaker' | 'none'
  repeatCount: number
  lastFingerprint: ToolCallFingerprint
  message?: string
}

/** 循环检测器状态 */
export interface LoopDetectorState {
  history: ToolCallFingerprint[]
  warningInjected: boolean
}

/** 循环检测配置 */
export interface LoopDetectorConfig {
  /** 滑动窗口大小 */
  slidingWindowSize: number
  /** Warning 阈值 */
  warningThreshold: number
  /** Critical 阈值 */
  criticalThreshold: number
  /** 熔断阈值 */
  circuitBreakerThreshold: number
}

/** 默认配置 */
export const DEFAULT_CONFIG: LoopDetectorConfig = {
  slidingWindowSize: 30,
  warningThreshold: 5,
  criticalThreshold: 8,
  circuitBreakerThreshold: 10,
}

/* AI end: 循环检测器类型定义结束 */
