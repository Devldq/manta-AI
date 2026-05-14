/* AI start: 循环检测器类 */
import type { ToolCallFingerprint, LoopDetectionResult, LoopDetectorState, LoopDetectorConfig } from './types'
import { DEFAULT_CONFIG } from './types'
import { simpleHash, computeCallKey, computeOutputKey } from './fingerprint'
import { detectLoop } from './detectors'

/**
 * 循环检测器类 - 维护滑动窗口状态并提供检测功能
 */
export class LoopDetector {
  private state: LoopDetectorState = {
    history: [],
    warningInjected: false,
  }

  private config: LoopDetectorConfig

  constructor(config: Partial<LoopDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 记录一次工具调用
   */
  recordCall(toolName: string, input: unknown, output: unknown, stepIndex: number): void {
    const callKey = computeCallKey(toolName, input)
    const outputKey = computeOutputKey(output)

    const fingerprint: ToolCallFingerprint = {
      callHash: simpleHash(callKey),
      outputHash: simpleHash(outputKey),
      toolName,
      input,
      output,
      stepIndex,
    }

    this.state.history.push(fingerprint)

    // 保持滑动窗口大小
    if (this.state.history.length > this.config.slidingWindowSize) {
      this.state.history.shift()
    }
  }

  /**
   * 检测是否陷入循环
   */
  detect(): LoopDetectionResult {
    return detectLoop(this.state.history, this.config.slidingWindowSize)
  }

  /**
   * 检查是否已注入过警告
   */
  hasInjectedWarning(): boolean {
    return this.state.warningInjected
  }

  /**
   * 标记已注入警告
   */
  markWarningInjected(): void {
    this.state.warningInjected = true
  }

  /**
   * 重置检测器
   */
  reset(): void {
    this.state = {
      history: [],
      warningInjected: false,
    }
  }

  /**
   * 获取历史记录长度（用于调试）
   */
  getHistoryLength(): number {
    return this.state.history.length
  }
}

// 导出所有模块
export * from './types'
export * from './fingerprint'
export * from './detectors'

/* AI end: 循环检测器类结束 */