/* Agent Registry — 扫描 openclaw 插件 */
// Manta 是 Agent OS，agent 定义权在 openclaw CLI 工具
// Registry 只负责：启动时扫描 openclaw 插件目录 → 返回 AgentEntry 列表
import type { AgentEntry } from '../core/types'
import { loadAllPluginAgents } from '../plugins/loader'

// 读取所有 Agent（纯插件扫描，无 manta-custom 概念）
export function loadAgents(): AgentEntry[] {
  return loadAllPluginAgents()
}

// 根据名字查找 Agent（仅查启用的）
export function findAgent(name: string): AgentEntry | null {
  const agents = loadAgents()
  return agents.find((a) => a.name === name && a.enabled) ?? null
}

// 列出启用的 Agents
export function listEnabledAgents(): AgentEntry[] {
  return loadAgents().filter((a) => a.enabled)
}
