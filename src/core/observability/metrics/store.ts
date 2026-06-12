/**
 * 内存级 Metrics 存储
 *
 * - 按 conversationId 聚合 SessionMetrics
 * - 每个 turn 结束时追加 TurnMetrics
 * - 提供查询和重置接口
 */

import type {
  TurnMetrics,
  SessionMetrics,
  StepMetrics,
  StepTokenUsage,
  ToolUsageMetrics,
} from './types'

/** 会话 id → 会话聚合指标 */
const sessionStore = new Map<string, SessionMetrics>()

/** 会话 id → 工具使用统计 */
const toolStore = new Map<string, Map<string, ToolUsageMetrics>>()

// ─── 工厂函数 ──────────────────────────────────────────────────────

function emptySession(conversationId: string): SessionMetrics {
  return {
    conversationId,
    totalTurns: 0,
    totalDurationMs: 0,
    avgTtftMs: 0,
    totalSteps: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cacheHitRate: 0,
    totalToolCalls: 0,
    toolCallSuccessRate: 0,
    errorTurns: 0,
    turns: [],
  }
}

function emptyToolMetrics(toolName: string): ToolUsageMetrics {
  return {
    toolName,
    callCount: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 0,
    avgDurationMs: 0,
    totalDurationMs: 0,
  }
}

// ─── 累加辅助 ──────────────────────────────────────────────────────

function recalcSession(session: SessionMetrics): void {
  const turns = session.turns
  if (turns.length === 0) return

  session.totalTurns = turns.length
  session.totalDurationMs = turns.reduce((s, t) => s + t.totalDurationMs, 0)
  session.avgTtftMs = Math.round(turns.reduce((s, t) => s + t.ttftMs, 0) / turns.length)
  session.totalSteps = turns.reduce((s, t) => s + t.totalSteps, 0)
  session.totalInputTokens = turns.reduce((s, t) => s + t.totalInputTokens, 0)
  session.totalOutputTokens = turns.reduce((s, t) => s + t.totalOutputTokens, 0)
  session.totalTokens = session.totalInputTokens + session.totalOutputTokens

  const cacheRead = turns.reduce((s, t) => s + t.cacheReadTokens, 0)
  const cacheWrite = turns.reduce((s, t) => s + t.cacheWriteTokens, 0)
  const totalIn = session.totalInputTokens
  session.cacheHitRate = totalIn > 0 ? cacheRead / totalIn : 0

  session.totalToolCalls = turns.reduce((s, t) => s + t.totalToolCalls, 0)
  const successCount = turns.reduce((s, t) => s + t.toolCallSuccessCount, 0)
  session.toolCallSuccessRate = session.totalToolCalls > 0
    ? successCount / session.totalToolCalls
    : 0

  session.errorTurns = turns.filter(t => t.toolCallErrorCount > 0 || t.stopReason.includes('error')).length
}

// ─── 公开 API ──────────────────────────────────────────────────────

/** 记录一轮对话的完整指标 */
export function recordTurn(turn: TurnMetrics): void {
  let session = sessionStore.get(turn.conversationId)
  if (!session) {
    session = emptySession(turn.conversationId)
    session.agentName = turn.conversationId // 占位，由外部设置
    sessionStore.set(turn.conversationId, session)
  }
  session.turns.push(turn)
  recalcSession(session)

  // 更新工具使用统计
  let convTools = toolStore.get(turn.conversationId)
  if (!convTools) {
    convTools = new Map()
    toolStore.set(turn.conversationId, convTools)
  }
  for (const step of turn.steps) {
    for (const toolName of step.toolNames) {
      let t = convTools.get(toolName)
      if (!t) {
        t = emptyToolMetrics(toolName)
        convTools.set(toolName, t)
      }
      t.callCount++
      // We don't have per-tool success/error breakdown from StepMetrics alone
      // Use overall step ratios
    }
  }
}

/** 获取会话聚合指标 */
export function getSession(conversationId: string): SessionMetrics | undefined {
  return sessionStore.get(conversationId)
}

/** 获取最近一轮的指标 */
export function getLastTurn(conversationId: string): TurnMetrics | undefined {
  const session = sessionStore.get(conversationId)
  if (!session || session.turns.length === 0) return undefined
  return session.turns[session.turns.length - 1]
}

/** 获取会话的工具统计 */
export function getToolStats(conversationId: string): ToolUsageMetrics[] {
  const m = toolStore.get(conversationId)
  if (!m) return []
  return Array.from(m.values()).sort((a, b) => b.callCount - a.callCount)
}

/** 重置指定会话的指标 */
export function resetSession(conversationId: string): void {
  sessionStore.delete(conversationId)
  toolStore.delete(conversationId)
}

/** 重置所有指标 */
export function resetAll(): void {
  sessionStore.clear()
  toolStore.clear()
}

/** 获取所有会话 ID 列表 */
export function getAllSessionIds(): string[] {
  return Array.from(sessionStore.keys())
}

/** 获取所有会话指标 */
export function getAllSessions(): SessionMetrics[] {
  return Array.from(sessionStore.values())
}
