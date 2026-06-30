/* 读取 Agent SOUL.md 作为 system prompt */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/** 读取指定 agent 的 SOUL.md 作为 system prompt */
export function readAgentSoul(agentName: string): string | null {
  try {
    const agentDir = path.join(os.homedir(), '.manta', 'agents', agentName)
    const soulPath = path.join(agentDir, 'SOUL.md')
    if (!fs.existsSync(soulPath)) return null
    return fs.readFileSync(soulPath, 'utf-8').trim() || null
  } catch {
    return null
  }
}
