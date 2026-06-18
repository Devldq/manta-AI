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
  criticalInjected: boolean
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
  warningThreshold: 5,       // 第 5 次 → 注入提示，模型自行调整
  criticalThreshold: 6,      // 第 6 次 → critical 警告（告诉模型陷入循环，给一次机会）
  circuitBreakerThreshold: 8, // 第 8 次 → 熔断停止
}

/* AI end: 循环检测器类型定义结束 */
