/* AI start: OpenClaw 集成模块 — 读取 ~/.openclaw/openclaw.json 获取 agent 信息 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const OC_HOME = path.join(os.homedir(), '.openclaw')
const OC_CFG = path.join(OC_HOME, 'openclaw.json')

// AI: openclaw.json 中的 agent 条目结构
export interface OcAgentEntry {
  id: string
  workspace: string
  subagents?: { allowAgents?: string[] }
}

// AI: 对外暴露的 OpenClaw Agent 信息
export interface OcAgentInfo {
  id: string
  workspace: string
  soulContent: string        // SOUL.md 内容
  allowAgents: string[]      // 允许通信的 agent
  isArmAgent: boolean        // 是否为本项目注册的 ARM agent
  status: 'active' | 'unknown'
  workspaceExists: boolean
}

// AI: 读取 openclaw.json，返回所有 agent 列表
export function readOpenclawConfig(): OcAgentEntry[] {
  try {
    if (!fs.existsSync(OC_CFG)) return []
    const cfg = JSON.parse(fs.readFileSync(OC_CFG, 'utf-8'))
    return (cfg?.agents?.list ?? []) as OcAgentEntry[]
  } catch {
    return []
  }
}

// AI: 获取单个 agent 的详细信息（含 SOUL.md）
export function getOcAgentInfo(entry: OcAgentEntry): OcAgentInfo {
  const ws = entry.workspace || path.join(OC_HOME, `workspace-${entry.id}`)
  const soulPath = path.join(ws, 'SOUL.md')
  const soulContent = fs.existsSync(soulPath)
    ? fs.readFileSync(soulPath, 'utf-8')
    : ''
  return {
    id: entry.id,
    workspace: ws,
    soulContent,
    allowAgents: entry.subagents?.allowAgents ?? [],
    isArmAgent: entry.id.startsWith('arm-'),
    status: 'active',
    workspaceExists: fs.existsSync(ws),
  }
}

// AI: 获取所有 OpenClaw agents 信息
export function getAllOcAgents(): OcAgentInfo[] {
  const entries = readOpenclawConfig()
  return entries.map(getOcAgentInfo)
}

// AI: 检查指定 agent 是否已在 openclaw.json 中注册
export function isAgentRegistered(agentId: string): boolean {
  const entries = readOpenclawConfig()
  return entries.some(e => e.id === agentId)
}

// AI: ARM 项目的 4 个 agent 在 OpenClaw 中的注册 ID
export const ARM_OC_AGENT_IDS = [
  'arm-architect',
  'arm-dev',
  'arm-qa',
  'arm-review',
] as const

// AI: 检查 ARM agents 的初始化状态
export interface ArmInitStatus {
  isOpenclawAvailable: boolean
  allRegistered: boolean
  registeredIds: string[]
  missingIds: string[]
}

export function checkArmInitStatus(): ArmInitStatus {
  const isAvailable = fs.existsSync(OC_CFG)
  if (!isAvailable) {
    return {
      isOpenclawAvailable: false,
      allRegistered: false,
      registeredIds: [],
      missingIds: [...ARM_OC_AGENT_IDS],
    }
  }
  const entries = readOpenclawConfig()
  const existingIds = new Set(entries.map(e => e.id))
  const registeredIds = ARM_OC_AGENT_IDS.filter(id => existingIds.has(id))
  const missingIds = ARM_OC_AGENT_IDS.filter(id => !existingIds.has(id))
  return {
    isOpenclawAvailable: true,
    allRegistered: missingIds.length === 0,
    registeredIds,
    missingIds,
  }
}

// AI: 运行初始化脚本（仅服务端调用）
export function runInitScript(): { success: boolean; output: string } {
  const scriptPath = path.join(process.cwd(), 'scripts', 'init-openclaw.sh')
  if (!fs.existsSync(scriptPath)) {
    return { success: false, output: 'init-openclaw.sh not found' }
  }
  try {
    execSync(`chmod +x "${scriptPath}"`, { stdio: 'pipe' })
    const output = execSync(`bash "${scriptPath}"`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, PATH: `/Users/${os.userInfo().username}/.openclaw/bin:${process.env.PATH}` },
    })
    return { success: true, output }
  } catch (err: unknown) {
    const e = err as { message?: string; stdout?: string; stderr?: string }
    return { success: false, output: e.stderr ?? e.message ?? 'unknown error' }
  }
}
/* AI end: OpenClaw 集成模块 */
