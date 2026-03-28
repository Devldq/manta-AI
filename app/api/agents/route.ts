/*  start: Agent Registry API — GET /api/agents（只读，agent 定义权在各 CLI 工具）*/
// AI: Manta 是 Agent OS，不持有 agent 定义权，POST 注册接口已移除
import { NextRequest, NextResponse } from 'next/server'
import { loadAgents, listEnabledAgents } from '@/registry'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const enabledOnly = searchParams.get('enabled') === 'true'
    const agents = enabledOnly ? listEnabledAgents() : loadAgents()
    return NextResponse.json({ agents })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Agent Registry API 结束 */
