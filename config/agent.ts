/* AI start: Agent 生命周期配置读取 — 从 config/agent.yaml 动态加载，支持在线修改 */
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'agent.yaml')

interface AgentConfigShape {
  INITIAL_HEALTH: number
  CLONE_THRESHOLD: number
  BAN_THRESHOLD: number
  SCORE_DELTA: number
}

const DEFAULTS: AgentConfigShape = {
  INITIAL_HEALTH: 60,
  CLONE_THRESHOLD: 90,
  BAN_THRESHOLD: 0,
  SCORE_DELTA: 5,
}

// AI: 每次调用都重新读取文件，支持运行时修改 agent.yaml 立即生效
export function loadAgentConfig(): AgentConfigShape {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = yaml.load(raw) as Partial<AgentConfigShape>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

// AI: 向后兼容导出（其他模块 import 这些命名常量时仍可用，但建议用 loadAgentConfig()）
export const agentConfig = loadAgentConfig()
export const { INITIAL_HEALTH, CLONE_THRESHOLD, BAN_THRESHOLD, SCORE_DELTA } = agentConfig
/* AI end: Agent 生命周期配置读取 */
