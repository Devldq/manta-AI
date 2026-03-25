import { NextResponse } from 'next/server'
import { cloneAgent, getAgentStats } from '@/lib/agentLifecycle'

interface Params { params: Promise<{ id: string }> }

// AI: POST /api/agents/[id]/clone — 复制 Agent（生命值 ≥ 90 时可用）
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params
  const stats = getAgentStats(id)
  if (stats.health < 90) {
    return NextResponse.json({ error: `生命值 ${stats.health} 不足 90，无法复制` }, { status: 400 })
  }
  const newAgent = cloneAgent(id)
  if (!newAgent) {
    return NextResponse.json({ error: '复制失败' }, { status: 500 })
  }
  return NextResponse.json(newAgent, { status: 201 })
}
