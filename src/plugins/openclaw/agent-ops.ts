/*  start: OpenClaw AgentOps — 实现 Core 定义的 AgentOps 接口（CLI 特有操作封装在此）*/
// AI: 本文件是插件层，封装所有 openclaw 特有的 agent 文件系统操作
// Core 层通过 AgentOps 接口调用，完全不感知底层实现细节
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { AgentOps, CreateAgentParams, UpdateAgentParams } from '../../core/types'

const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json')
const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw')

// AI: 展开 ~ 路径
function expandPath(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

// AI: workspace 目录路径（~/.openclaw/workspace-<name>/）
function workspaceDir(name: string): string {
  return path.join(OPENCLAW_DIR, `workspace-${name}`)
}

// AI: 读取 openclaw.json，失败返回 null
function readConfig(): Record<string, unknown> | null {
  if (!fs.existsSync(OPENCLAW_CONFIG)) return null
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG, 'utf-8'))
  } catch {
    return null
  }
}

// AI: 写入 openclaw.json（写前自动备份）
function writeConfig(config: Record<string, unknown>): void {
  if (fs.existsSync(OPENCLAW_CONFIG)) {
    fs.copyFileSync(OPENCLAW_CONFIG, `${OPENCLAW_CONFIG}.bak.${Date.now()}`)
  }
  fs.writeFileSync(OPENCLAW_CONFIG, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * OpenClaw 插件的 AgentOps 实现
 * agent 定义文件：~/.openclaw/workspace-<name>/SOUL.md
 * agent 注册：~/.openclaw/openclaw.json → agents.list
 */
export const openclawAgentOps: AgentOps = {
  /**
   * 在 openclaw 中创建 agent：
   * 1. 创建 workspace 目录 + 写入 SOUL.md
   * 2. 在 openclaw.json 的 agents.list 中追加记录
   */
  async createAgent(params: CreateAgentParams): Promise<void> {
    const { name, soul, description } = params

    // AI: 1. 创建 workspace 目录
    const wsDir = workspaceDir(name)
    fs.mkdirSync(wsDir, { recursive: true })

    // AI: 2. 写入 SOUL.md
    const soulPath = path.join(wsDir, 'SOUL.md')
    fs.writeFileSync(soulPath, soul ?? `# ${name} Agent · SOUL\n\n你是一个 AI Agent。\n`, 'utf-8')

    // AI: 3. 更新 openclaw.json 的 agents.list
    const config = readConfig()
    if (!config) {
      throw new Error(`openclaw.json 不存在（路径：${OPENCLAW_CONFIG}），无法注册 agent`)
    }

    const agents = config.agents as { list?: Array<Record<string, unknown>> } | undefined
    const list: Array<Record<string, unknown>> = agents?.list ?? []

    // AI: 如果已存在同名，跳过追加（updateAgent 负责更新）
    const exists = list.some((a) => a.id === name)
    if (!exists) {
      list.push({
        id: name,
        name,
        workspace: wsDir,
        description: description ?? '',
      })
      ;(config.agents as Record<string, unknown>) ??= {}
      ;(config.agents as Record<string, unknown[]>).list = list
      writeConfig(config)
    }
  },

  /**
   * 更新 openclaw agent：
   * - 若 soul 有变化，覆盖写 workspace/SOUL.md（写前备份）
   * - 若 description 有变化，更新 openclaw.json 中的记录
   */
  async updateAgent(name: string, params: UpdateAgentParams): Promise<void> {
    const { soul, description } = params
    const wsDir = workspaceDir(name)
    const soulPath = path.join(wsDir, 'SOUL.md')

    // AI: 更新 SOUL.md
    if (soul !== undefined) {
      if (fs.existsSync(soulPath)) {
        fs.copyFileSync(soulPath, `${soulPath}.bak.${Date.now()}`)
      }
      fs.mkdirSync(wsDir, { recursive: true })
      fs.writeFileSync(soulPath, soul, 'utf-8')
    }

    // AI: 更新 openclaw.json 中的 description
    if (description !== undefined) {
      const config = readConfig()
      if (config) {
        const list = (config?.agents as { list?: Array<Record<string, unknown>> })?.list ?? []
        const idx = list.findIndex((a) => a.id === name)
        if (idx >= 0) {
          list[idx] = { ...list[idx], description }
          ;(config.agents as Record<string, unknown[]>).list = list
          writeConfig(config)
        }
      }
    }
  },

  /**
   * 读取 openclaw agent 的系统提示（SOUL.md 内容）
   */
  async readAgentContent(name: string): Promise<string | null> {
    // AI: 优先从 openclaw.json 里找 workspace 路径（支持自定义 workspace 路径的 agent）
    const config = readConfig()
    const list = (config?.agents as { list?: Array<{ id?: string; workspace?: string }> })?.list ?? []
    const entry = list.find((a) => a.id === name)

    let soulPath: string
    if (entry?.workspace) {
      soulPath = path.join(expandPath(entry.workspace), 'SOUL.md')
    } else {
      soulPath = path.join(workspaceDir(name), 'SOUL.md')
    }

    if (!fs.existsSync(soulPath)) return null
    try {
      return fs.readFileSync(soulPath, 'utf-8')
    } catch {
      return null
    }
  },

  /**
   * 删除 openclaw agent：
   * - 从 openclaw.json 的 agents.list 中移除记录
   * - 注意：不删除 workspace 目录（防止误删用户数据）
   */
  async deleteAgent(name: string): Promise<void> {
    const config = readConfig()
    if (!config) return

    const list = (config?.agents as { list?: Array<Record<string, unknown>> })?.list ?? []
    const newList = list.filter((a) => a.id !== name)
    ;(config.agents as Record<string, unknown[]>).list = newList
    writeConfig(config)
    // AI: workspace 目录保留（用户可手动清理），避免误删
  },

  /**
   * 检查 agent 是否已存在于 openclaw.json
   */
  async agentExists(name: string): Promise<boolean> {
    const config = readConfig()
    const list = (config?.agents as { list?: Array<{ id?: string }> })?.list ?? []
    return list.some((a) => a.id === name)
  },
}
/*  end: OpenClaw AgentOps 结束 */
