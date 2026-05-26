/* AI start: 读取 Agent SOUL.md 作为 system prompt */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/** 读取指定 agent 的 SOUL.md 作为 system prompt */
export function readAgentSoul(agentName: string): string | null {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
    if (!fs.existsSync(configPath)) return null

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; name?: string; workspace?: string }> = config?.agents?.list ?? []
    const entry = list.find((a) => a.id === agentName || a.name === agentName)
    if (!entry) return null

    let workspace = entry.workspace
    if (!workspace) {
      workspace = path.join(os.homedir(), '.openclaw', `workspace-${agentName}`)
    } else if (workspace.startsWith('~/')) {
      workspace = path.join(os.homedir(), workspace.slice(2))
    }

    const soulPath = path.join(workspace, 'SOUL.md')
    if (!fs.existsSync(soulPath)) return null
    return fs.readFileSync(soulPath, 'utf-8').trim() || null
  } catch {
    return null
  }
}
/* AI end: Agent SOUL.md 读取逻辑结束 */
