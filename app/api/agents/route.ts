/*  start: Agent Registry API — GET /api/agents（查询）, POST /api/agents（注册）*/
import { NextRequest, NextResponse } from 'next/server'
import { loadAgents, registerAgent, listEnabledAgents } from '@/registry'
import type { AgentEntry } from '@/core/types'

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, runnerId, bin, skills, description } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Agent 名字不能为空' }, { status: 400 })
    }
    if (!runnerId?.trim()) {
      return NextResponse.json({ error: '必须指定 runnerId' }, { status: 400 })
    }

    const entry: AgentEntry = {
      name: name.trim(),
      runnerId: runnerId.trim(),
      bin: bin?.trim() || '',
      skills: skills ?? [],
      description: description?.trim(),
      enabled: true,
    }

    registerAgent(entry)
    return NextResponse.json({ agent: entry }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Agent Registry API 结束 */
