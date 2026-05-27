/* AI start: 循环检测器实现 */
import type { ToolCallFingerprint, LoopDetectionResult } from './types'
import { DEFAULT_CONFIG } from './types'

const {
  warningThreshold: WARNING_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
  circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
} = DEFAULT_CONFIG

/**
 * 检测通用重复：同一个工具、同样的参数反复调用
 *
 * 两级匹配：
 * - 完全重复（callHash + outputHash 都相同）：最严重，相同输入相同输出
 * - 参数重复（仅 callHash 相同）：相同输入但输出不同（如每次 404 错误文本不同）
 *   参数重复达到阈值时也触发检测，避免因输出微小差异导致永远检测不到
 *
 * 例如：连续 5 次搜索同一个 URL 返回 404，即使每次错误信息略有不同也应检测到
 */
export function detectGeneralRepeat(
  history: ToolCallFingerprint[]
): LoopDetectionResult | null {
  if (history.length < 2) return null

  // 取最近的调用
  const last = history[history.length - 1]
  if (!last) return null

  // 连续查找完全相同的调用（callHash + outputHash 都相同）
  let exactRepeatCount = 0
  for (let i = history.length - 2; i >= 0; i--) {
    const prev = history[i]
    if (prev.callHash === last.callHash && prev.outputHash === last.outputHash) {
      exactRepeatCount++
    } else {
      break
    }
  }

  // 完全重复达到阈值 → 直接按原有逻辑处理
  if (exactRepeatCount >= WARNING_THRESHOLD - 1) {
    const severity = exactRepeatCount >= CIRCUIT_BREAKER_THRESHOLD - 1
      ? 'circuit-breaker'
      : exactRepeatCount >= CRITICAL_THRESHOLD - 1
        ? 'critical'
        : 'warning'

    return {
      type: 'general-repeat',
      severity,
      repeatCount: exactRepeatCount + 1,
      lastFingerprint: last,
      message: `检测到重复调用：工具 ${last.toolName} 以相同参数和结果被调用了 ${exactRepeatCount + 1} 次，请尝试其他方法或策略。`,
    }
  }

  // 参数重复检测：仅 callHash 相同，但 output 不同
  // 使用稍高的阈值（避免偶发的正常重复被误判）
  let paramRepeatCount = 0
  for (let i = history.length - 2; i >= 0; i--) {
    const prev = history[i]
    if (prev.callHash === last.callHash) {
      paramRepeatCount++
    } else {
      break
    }
  }

  const PARAM_WARNING = WARNING_THRESHOLD + 2   // 7 次 → warning
  const PARAM_CRITICAL = CRITICAL_THRESHOLD + 2  // 10 次 → critical
  const PARAM_BREAKER = CIRCUIT_BREAKER_THRESHOLD + 2  // 12 次 → 熔断

  if (paramRepeatCount >= PARAM_WARNING - 1) {
    const severity = paramRepeatCount >= PARAM_BREAKER - 1
      ? 'circuit-breaker'
      : paramRepeatCount >= PARAM_CRITICAL - 1
        ? 'critical'
        : 'warning'

    return {
      type: 'general-repeat',
      severity,
      repeatCount: paramRepeatCount + 1,
      lastFingerprint: last,
      message: `检测到重复调用：工具 ${last.toolName} 以相同参数被调用了 ${paramRepeatCount + 1} 次（每次输出不同），请尝试其他方法或策略。`,
    }
  }

  return null
}

/**
 * 检测乒乓循环：两个操作来回交替
 * 例如：read_file → write_file → read_file → write_file
 *
 * P2-6 修复：不再只看最近 4 步设 repeatCount=2（永远不会触发阈值），
 * 而是累计交替出现的次数。扫描滑动窗口，当连续出现 A-B-A-B 模式时
 * 计算交替对数 (A,B) 的重复次数。
 */
export function detectPingPong(
  history: ToolCallFingerprint[]
): LoopDetectionResult | null {
  if (history.length < 4) return null

  // 从末尾往前扫描，找最长的交替序列
  let last = history[history.length - 1]
  let secondLast = history[history.length - 2]

  if (!last || !secondLast) return null

  // 两个不同的操作才算交替
  if (last.callHash === secondLast.callHash) return null

  // 交替模式：最后两步是 (A, B)
  const callHashA = last.callHash
  const callHashB = secondLast.callHash
  const toolNameA = last.toolName
  const toolNameB = secondLast.toolName

  // 从末尾往前统计交替对数 (A, B) 的重复次数
  let alternatingPairs = 1  // 最后两步本身就是一对
  let i = history.length - 3

  while (i >= 1) {
    const current = history[i]
    const prev = history[i - 1]

    if (!current || !prev) break

    // 检查 (prev, current) 是否匹配 (B, A) 即 (callHashB, callHashA)
    if (prev.callHash === callHashB && current.callHash === callHashA) {
      alternatingPairs++
      i -= 2  // 往前跳两步
    } else {
      break  // 交替中断
    }
  }

  if (alternatingPairs >= WARNING_THRESHOLD - 1) {
    const severity = alternatingPairs >= CIRCUIT_BREAKER_THRESHOLD - 1
      ? 'circuit-breaker'
      : alternatingPairs >= CRITICAL_THRESHOLD - 1
        ? 'critical'
        : 'warning'

    return {
      type: 'ping-pong',
      severity,
      repeatCount: alternatingPairs * 2,  // 每对包含 2 步
      lastFingerprint: last,
      message: `检测到乒乓循环：工具 ${toolNameA} 和 ${toolNameB} 来回交替 ${alternatingPairs} 次，请尝试其他方法打破循环。`,
    }
  }

  return null
}

/**
 * 检测轮询无进展：连续 poll 检查状态，结果一直是 "running"
 * 例如：连续多次查询同一个任务状态，结果都是 status: "running"
 */
export function detectPollingNoProgress(
  history: ToolCallFingerprint[]
): LoopDetectionResult | null {
  if (history.length < 3) return null

  const last = history[history.length - 1]
  if (!last) return null

  // 常见的轮询工具名
  const pollingTools = ['getStatus', 'checkStatus', 'poll', 'getTaskStatus', 'queryStatus']
  const isPollingTool = pollingTools.some(t => last.toolName.toLowerCase().includes(t.toLowerCase()))

  // 检查输出中是否包含"无进展"状态
  const output = last.output
  if (!output || typeof output !== 'object') return null

  const outputObj = output as Record<string, unknown>

  // 检测无进展状态
  const noProgressIndicators = [
    { status: 'running' },
    { status: 'pending' },
    { status: 'in_progress' },
    { state: 'running' },
    { state: 'pending' },
    { status: 'processing' },
  ]

  let hasNoProgress = false
  for (const indicator of noProgressIndicators) {
    const key = Object.keys(indicator)[0] as string
    const value = (indicator as Record<string, unknown>)[key]
    if (outputObj[key] === value) {
      hasNoProgress = true
      break
    }
  }

  if (!isPollingTool && !hasNoProgress) return null

  // 在历史中连续查找"无进展"结果
  let repeatCount = 0
  for (let i = history.length - 2; i >= 0; i--) {
    const prev = history[i]
    // 检查是否是同一工具且输出类似（都表示无进展）
    if (prev.toolName === last.toolName || isPollingTool) {
      const prevOutput = prev.output as Record<string, unknown> | null
      if (prevOutput) {
        const prevHasNoProgress = noProgressIndicators.some(indicator => {
          const key = Object.keys(indicator)[0] as string
          return prevOutput[key] === (indicator as Record<string, unknown>)[key]
        })
        if (prevHasNoProgress || isPollingTool) {
          repeatCount++
          continue
        }
      }
    }
    break
  }

  if (repeatCount >= WARNING_THRESHOLD - 1) {
    const severity = repeatCount >= CIRCUIT_BREAKER_THRESHOLD - 1
      ? 'circuit-breaker'
      : repeatCount >= CRITICAL_THRESHOLD - 1
        ? 'critical'
        : 'warning'

    return {
      type: 'polling',
      severity,
      repeatCount: repeatCount + 1,
      lastFingerprint: last,
      message: `检测到轮询无进展：工具 ${last.toolName} 连续 ${repeatCount + 1} 次返回相同状态，请等待任务完成或尝试其他方法。`,
    }
  }

  return null
}

/**
 * 主循环检测函数：综合三种检测模式
 */
export function detectLoop(
  history: ToolCallFingerprint[],
  slidingWindowSize: number = DEFAULT_CONFIG.slidingWindowSize
): LoopDetectionResult {
  if (history.length < WARNING_THRESHOLD) {
    return {
      type: 'none',
      severity: 'none',
      repeatCount: 0,
      lastFingerprint: history[history.length - 1]!,
    }
  }

  // 取最近 slidingWindowSize 步
  const recentHistory = history.slice(-slidingWindowSize)

  // 1. 检测通用重复
  const generalResult = detectGeneralRepeat(recentHistory)
  if (generalResult) return generalResult

  // 2. 检测乒乓循环
  const pingPongResult = detectPingPong(recentHistory)
  if (pingPongResult) return pingPongResult

  // 3. 检测轮询无进展
  const pollingResult = detectPollingNoProgress(recentHistory)
  if (pollingResult) return pollingResult

  return {
    type: 'none',
    severity: 'none',
    repeatCount: 0,
    lastFingerprint: history[history.length - 1]!,
  }
}

/* AI end: 循环检测器实现结束 */