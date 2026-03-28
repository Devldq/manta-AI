/*  start: Agent 注入 API — POST /api/agents/inject */
// AI: Core 层只知道 AgentOps 接口，通过 getAgentOps(pluginId) 获取对应插件的实现
// CLI 特有的文件操作全部封装在对应插件的 agent-ops.ts 里
import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAgentOps } from '@/plugins/loader'

const MANTA_AGENTS_DIR = path.join(os.homedir(), 'manta-data', 'agents')

interface InjectResult {
  name: string
  targetCli: string
  status: 'injected' | 'updated' | 'skipped' | 'error'
  message?: string
}

// AI: POST /api/agents/inject — 把所有 Manta 管理的 agent 同步到对应 CLI
export async function POST() {
  const results: InjectResult[] = []

  if (!fs.existsSync(MANTA_AGENTS_DIR)) {
    return NextResponse.json({ results: [], message: '暂无 Manta 管理的 agent' })
  }

  for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(MANTA_AGENTS_DIR, entry.name, 'agent.json')
    if (!fs.existsSync(metaPath)) continue

    let meta: { name: string; targetCli: string; description?: string }
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    } catch (err) {
      results.push({ name: entry.name, targetCli: 'unknown', status: 'error', message: String(err) })
      continue
    }

    // AI: 通过插件接口操作，Core 层不感知 CLI 特有逻辑
    const ops = getAgentOps(meta.targetCli)
    if (!ops) {
      results.push({ name: meta.name, targetCli: meta.targetCli, status: 'skipped', message: `不支持的 targetCli: ${meta.targetCli}` })
      continue
    }

    try {
      const alreadyExists = await ops.agentExists(meta.name)
      const soul = await ops.readAgentContent(meta.name) ?? ''

      if (alreadyExists) {
        // AI: 已存在则更新（以 Manta 元数据为准，soul 从 CLI 读取后原样写回）
        await ops.updateAgent(meta.name, { description: meta.description })
        results.push({ name: meta.name, targetCli: meta.targetCli, status: 'updated' })
      } else {
        // AI: 不存在则创建（soul 为空字符串，需要用户在 UI 中填写后保存）
        await ops.createAgent({ name: meta.name, soul, description: meta.description })
        results.push({ name: meta.name, targetCli: meta.targetCli, status: 'injected' })
      }
    } catch (err) {
      results.push({ name: meta.name, targetCli: meta.targetCli, status: 'error', message: String(err) })
    }
  }

  return NextResponse.json({ results })
}

// AI: GET /api/agents/inject — 查询注入状态（不执行注入）
export async function GET() {
  const status: Array<{ name: string; targetCli: string; injected: boolean }> = []

  if (!fs.existsSync(MANTA_AGENTS_DIR)) {
    return NextResponse.json({ status: [] })
  }

  for (const entry of fs.readdirSync(MANTA_AGENTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const metaPath = path.join(MANTA_AGENTS_DIR, entry.name, 'agent.json')
    if (!fs.existsSync(metaPath)) continue

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      const ops = getAgentOps(meta.targetCli)
      const injected = ops ? await ops.agentExists(meta.name) : false
      status.push({ name: meta.name, targetCli: meta.targetCli, injected })
    } catch { /* skip */ }
  }

  return NextResponse.json({ status })
}
/*  end: Agent 注入 API 结束 */
