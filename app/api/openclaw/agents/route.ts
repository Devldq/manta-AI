import { NextResponse } from 'next/server'
import { getAllOcAgents } from '@/lib/openclawIntegration'

// AI: GET /api/openclaw/agents — 获取 OpenClaw 中所有 agents 列表
export async function GET() {
  const agents = getAllOcAgents()
  return NextResponse.json(agents)
}
