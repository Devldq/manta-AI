import { NextResponse } from 'next/server'
import { AGENT_IDS, AGENTS_DIR, ensureDir } from '@/lib/dataStore'
import { getAgentStats } from '@/lib/agentLifecycle'
import type { AgentStats } from '@/lib/types'
import fs from 'fs'
import path from 'path'

// AI: GET /api/agents — 获取所有 Agent 状态（包含克隆代）
export async function GET() {
  ensureDir(AGENTS_DIR)

  // AI: 扫描 AGENTS_DIR 获取所有 Agent（包含克隆代 _gN）
  const agentDirs = fs.existsSync(AGENTS_DIR)
    ? fs.readdirSync(AGENTS_DIR).filter(d =>
        fs.statSync(path.join(AGENTS_DIR, d)).isDirectory()
      )
    : [...AGENT_IDS]

  const result: AgentStats[] = agentDirs.map(id => getAgentStats(id))
  return NextResponse.json(result)
}
