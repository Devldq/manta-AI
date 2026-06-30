/* Agent Registry — Manta 原生 agent 注册表 */
// Manta 的 agent 定义权在应用层（AppConfig），注册表负责提供查询接口
import type { AgentEntry } from '../core/types'
import { loadAllPluginAgents } from '../plugins/loader'

// 读取所有 Agent（插件扫描 + 应用层注册）
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
