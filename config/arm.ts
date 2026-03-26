/* AI start: ARM 触发配置读取 — 从 config/arm.yaml 动态加载，修改后立即生效 */
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'arm.yaml')

export type TriggerMode = 'local' | 'im'

export interface TriggerRule {
  on_status: string
  agent: string
  require_workflow?: boolean
}

export interface ArmConfig {
  trigger_mode: TriggerMode
  im: {
    channel: string
    targets: Record<string, string>
  }
  local: {
    openclaw_bin: string
    timeout: number
  }
  agent_ids: Record<string, string>
  trigger_rules: TriggerRule[]
}

const DEFAULTS: ArmConfig = {
  trigger_mode: 'local',
  im: { channel: 'kim', targets: {} },
  local: { openclaw_bin: '', timeout: 600 },
  agent_ids: {
    architect: 'arm-architect',
    dev: 'arm-dev',
    qa: 'arm-qa',
    review: 'arm-review',
  },
  trigger_rules: [
    { on_status: 'Inbox', agent: 'architect', require_workflow: true },
    { on_status: 'InProgress', agent: 'auto', require_workflow: true },
  ],
}

// AI: 每次调用重新读取文件，运行时修改 arm.yaml 立即生效
export function loadArmConfig(): ArmConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = yaml.load(raw) as Partial<ArmConfig>
    return {
      ...DEFAULTS,
      ...parsed,
      im: { ...DEFAULTS.im, ...(parsed?.im ?? {}) },
      local: { ...DEFAULTS.local, ...(parsed?.local ?? {}) },
      agent_ids: { ...DEFAULTS.agent_ids, ...(parsed?.agent_ids ?? {}) },
      trigger_rules: parsed?.trigger_rules ?? DEFAULTS.trigger_rules,
    }
  } catch {
    return DEFAULTS
  }
}
/* AI end: ARM 触发配置读取 */
