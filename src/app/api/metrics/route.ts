/**
 * Metrics API — 查询实时运行指标
 *
 * GET /api/metrics?conversationId=xxx
 *   → { session: SessionMetrics | null, lastTurn: TurnMetrics | null, toolStats: ToolUsageMetrics[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession, getLastTurn, getToolStats } from '@observability/metrics'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const conversationId = searchParams.get('conversationId')

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
  }

  const session = getSession(conversationId)
  const lastTurn = getLastTurn(conversationId)
  const toolStats = getToolStats(conversationId)

  return NextResponse.json({
    session: session ?? null,
    lastTurn: lastTurn ?? null,
    toolStats,
  })
}
