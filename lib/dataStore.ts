import fs from 'fs'
import path from 'path'
import os from 'os'

// AI: 本机数据根目录，通过环境变量配置，默认 ~/arm-data
export const DATA_ROOT = process.env.ARM_DATA_ROOT
  ? path.resolve(process.env.ARM_DATA_ROOT.replace('~', os.homedir()))
  : path.join(os.homedir(), 'arm-data')

export const TASKS_FILE = path.join(DATA_ROOT, 'tasks.json')
export const NOTIFICATIONS_FILE = path.join(DATA_ROOT, 'notifications.jsonl')
export const WORKFLOWS_DIR = path.join(DATA_ROOT, 'workflows')
export const AGENTS_DIR = path.join(DATA_ROOT, 'agents')

export const AGENT_IDS = ['architect', 'dev', 'qa', 'review'] as const
export type AgentId = typeof AGENT_IDS[number]

export function agentDir(agentId: AgentId | string) {
  return path.join(AGENTS_DIR, agentId)
}
export function agentStatsFile(agentId: AgentId | string) {
  return path.join(AGENTS_DIR, agentId, 'stats.json')
}
export function agentQueueFile(agentId: AgentId | string) {
  return path.join(AGENTS_DIR, agentId, 'queue.jsonl')
}
export function agentTasksDir(agentId: AgentId | string) {
  return path.join(AGENTS_DIR, agentId, 'tasks')
}
export function agentSoulFile(agentId: AgentId | string) {
  return path.join(AGENTS_DIR, agentId, 'SOUL.md')
}

// AI: 通用文件读写工具
export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

export function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function appendJsonl(filePath: string, record: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8')
}

export function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return []
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as T)
  } catch {
    return []
  }
}

export function readText(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return ''
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
