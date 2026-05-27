/* MetricsDashboard — 实时运行指标面板，替换 SystemLogs 顶部的统计栏 */

'use client'

import React, { memo } from 'react'
import { useMetrics } from '@/core/log/hooks'
import {
  Clock,
  Zap,
  Footprints,
  Wrench,
  Coins,
  CheckCircle2,
  XCircle,
  Layers,
  BarChart3,
} from 'lucide-react'

interface MetricsDashboardProps {
  conversationId?: string
}

/** 格式化数字：≥10000 显示 x.xw，否则千分位 */
function fmtNum(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return n.toLocaleString()
}

/** 格式化毫秒 */
function fmtMs(ms: number): string {
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return ms + 'ms'
}

/** 百分比格式化 */
function fmtPct(rate: number): string {
  return (rate * 100).toFixed(0) + '%'
}

export const MetricsDashboard = memo(function MetricsDashboard({
  conversationId,
}: MetricsDashboardProps) {
  const { lastTurn, session, loading } = useMetrics(conversationId)

  // 无数据时不展示
  if (!lastTurn && !session) return null

  return (
    <div className="px-2 py-1.5 border-b border-border-subtle bg-background">
      {/* ── 上一轮指标（高亮行） ── */}
      {lastTurn && (
        <div className="flex items-center gap-3 mb-1">
          <span className="text-[10px] font-semibold text-text-secondary flex-shrink-0">
            最近一轮
          </span>

          {/* TTFT */}
          <span
            className="inline-flex items-center gap-1 text-[10px] text-accent"
            title={`首字延迟: ${lastTurn.ttftMs}ms`}
          >
            <Zap size={10} />
            <span className="font-mono tabular-nums">{fmtMs(lastTurn.ttftMs)}</span>
          </span>

          {/* 总耗时 */}
          <span
            className="inline-flex items-center gap-1 text-[10px] text-text-muted"
            title={`总耗时: ${lastTurn.totalDurationMs}ms`}
          >
            <Clock size={10} />
            <span className="font-mono tabular-nums">{fmtMs(lastTurn.totalDurationMs)}</span>
          </span>

          {/* 步数 + 工具 */}
          <span
            className="inline-flex items-center gap-1 text-[10px] text-text-muted"
            title={`${lastTurn.totalSteps} 步, ${lastTurn.totalToolCalls} 工具调用`}
          >
            <Footprints size={10} />
            <span className="font-mono tabular-nums">
              {lastTurn.totalSteps}步
            </span>
            <Wrench size={10} className="ml-1" />
            <span className="font-mono tabular-nums">
              {lastTurn.totalToolCalls}
            </span>
            {lastTurn.totalToolCalls > 0 && (
              <>
                {lastTurn.toolCallErrorCount > 0 ? (
                  <span className="text-red-500 font-mono tabular-nums">
                    ({lastTurn.toolCallErrorCount}错)
                  </span>
                ) : (
                  <span className="text-green-500">
                    <CheckCircle2 size={10} />
                  </span>
                )}
              </>
            )}
          </span>

          {/* Token */}
          <span
            className="inline-flex items-center gap-1 text-[10px] text-text-muted ml-auto"
            title={`Input: ${fmtNum(lastTurn.totalInputTokens)} | Output: ${fmtNum(lastTurn.totalOutputTokens)} | Cache: ${fmtNum(lastTurn.cacheReadTokens)}`}
          >
            <Coins size={10} />
            <span className="font-mono tabular-nums">{fmtNum(lastTurn.totalTokens)}</span>
            {lastTurn.cacheReadTokens > 0 && (
              <span className="text-green-500 font-mono tabular-nums">
                (+{fmtNum(lastTurn.cacheReadTokens)})
              </span>
            )}
          </span>

          {/* 停止原因 */}
          <span className="text-[9px] text-text-muted/50 flex-shrink-0">
            {lastTurn.stopReason === 'no-tool-calls' ? '自然结束' : lastTurn.stopReason}
          </span>
        </div>
      )}

      {/* ── 会话聚合行（次级） ── */}
      {session && session.totalTurns > 1 && (
        <div className="flex items-center gap-3 text-[9px] text-text-muted/70 border-t border-border-subtle/50 pt-1">
          <span className="font-semibold text-text-muted/50 flex-shrink-0">
            会话汇总
          </span>

          <span className="inline-flex items-center gap-1">
            <Layers size={9} />
            <span className="font-mono tabular-nums">{session.totalTurns}轮</span>
          </span>

          <span className="inline-flex items-center gap-1">
            <Zap size={9} />
            <span className="font-mono tabular-nums">均{fmtMs(session.avgTtftMs)}</span>
          </span>

          <span className="inline-flex items-center gap-1">
            <Footprints size={9} />
            <span className="font-mono tabular-nums">{session.totalSteps}步</span>
          </span>

          <span className="inline-flex items-center gap-1">
            <Coins size={9} />
            <span className="font-mono tabular-nums">{fmtNum(session.totalTokens)}</span>
            <span style={{ color: session.cacheHitRate > 0 ? '#10b981' : undefined }} className="font-mono tabular-nums">
              ({fmtPct(session.cacheHitRate)})
            </span>
          </span>

          <span className="inline-flex items-center gap-1">
            <Wrench size={9} />
            <span className="font-mono tabular-nums">{session.totalToolCalls}</span>
            <span
              className={`font-mono tabular-nums ${
                session.toolCallSuccessRate >= 0.95 ? 'text-green-500' :
                session.toolCallSuccessRate >= 0.8 ? 'text-yellow-500' : 'text-red-500'
              }`}
            >
              {fmtPct(session.toolCallSuccessRate)}
            </span>
          </span>

          {session.errorTurns > 0 && (
            <span className="inline-flex items-center gap-1 text-red-500">
              <XCircle size={9} />
              <span className="font-mono tabular-nums">{session.errorTurns}</span>
            </span>
          )}
        </div>
      )}

      {/* 空状态提示 */}
      {loading && !lastTurn && !session && (
        <div className="flex items-center gap-2 text-[10px] text-text-muted/50">
          <BarChart3 size={10} className="animate-pulse" />
          <span>等待运行指标...</span>
        </div>
      )}
    </div>
  )
})

export default MetricsDashboard
