/*  start: Agent Registry — 只做插件扫描，Manta 不持有 agent 定义权 */
// AI: Manta 是 Agent OS，agent 定义权在各 CLI 工具（openclaw/claude-code/codeflicker）
// Registry 只负责：启动时扫描各插件目录 → 合并返回 AgentEntry 列表
import type { AgentEntry } from '../core/types'
import { loadAllPluginAgents } from '../plugins/loader'

// AI: 读取所有 Agent（纯插件扫描，无 manta-custom 概念）
export function loadAgents(): AgentEntry[] {
  return loadAllPluginAgents()
}

// AI: 根据名字查找 Agent（仅查启用的）
export function findAgent(name: string): AgentEntry | null {
  const agents = loadAgents()
  return agents.find((a) => a.name === name && a.enabled) ?? null
}

// AI: 列出启用的 Agents
export function listEnabledAgents(): AgentEntry[] {
  return loadAgents().filter((a) => a.enabled)
}
/*  end: Agent Registry 结束 */
