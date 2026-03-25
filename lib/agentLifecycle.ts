import fs from 'fs'
import { readJson, writeJson, agentStatsFile, agentDir, agentTasksDir, ensureDir } from './dataStore'
import type { AgentStats } from './types'

/* AI start: Agent 生命周期管理 — 生命值奖惩、复制、封禁 */

export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  architect: '架构师',
  dev: '开发工程师',
  qa: 'QA 工程师',
  review: '代码审查官',
}

export const INITIAL_HEALTH = 60
export const CLONE_THRESHOLD = 90
export const BAN_THRESHOLD = 0
export const SCORE_DELTA = 5

export function getAgentStats(agentId: string): AgentStats {
  const defaultStats: AgentStats = {
    agentId,
    displayName: AGENT_DISPLAY_NAMES[agentId] ?? agentId,
    health: INITIAL_HEALTH,
    status: 'active',
    generation: 1,
    parentId: null,
    completedTasks: 0,
    failedTasks: 0,
    totalTokens: 0,
    skills: [],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }
  return readJson<AgentStats>(agentStatsFile(agentId), defaultStats)
}

export function saveAgentStats(stats: AgentStats): void {
  writeJson(agentStatsFile(stats.agentId), stats)
}

// AI: 调整生命值，并触发封禁/可复制状态变更
export function adjustHealth(
  agentId: string,
  delta: number
): { stats: AgentStats; event: 'normal' | 'can_clone' | 'banned' } {
  const stats = getAgentStats(agentId)
  const newHealth = Math.max(0, Math.min(100, stats.health + delta))
  stats.health = newHealth
  stats.lastActiveAt = new Date().toISOString()

  if (newHealth <= BAN_THRESHOLD && stats.status === 'active') {
    stats.status = 'banned'
    saveAgentStats(stats)
    return { stats, event: 'banned' }
  }

  if (newHealth >= CLONE_THRESHOLD && stats.status === 'active') {
    saveAgentStats(stats)
    return { stats, event: 'can_clone' }
  }

  saveAgentStats(stats)
  return { stats, event: 'normal' }
}

// AI: 复制 Agent — 新 Agent 继承父 Agent 的 SOUL.md 和 skills
export function cloneAgent(parentId: string): AgentStats | null {
  const parent = getAgentStats(parentId)
  if (parent.status !== 'active' || parent.health < CLONE_THRESHOLD) return null

  // AI: 生成新 Agent ID，格式为 {parentId}_{generation+1}
  const newId = `${parentId}_g${parent.generation + 1}`
  ensureDir(agentDir(newId))
  ensureDir(agentTasksDir(newId))

  // AI: 继承父 Agent 的 SOUL.md
  const parentSoulPath = `${agentDir(parentId)}/SOUL.md`
  if (fs.existsSync(parentSoulPath)) {
    fs.copyFileSync(parentSoulPath, `${agentDir(newId)}/SOUL.md`)
  }

  const newStats: AgentStats = {
    agentId: newId,
    displayName: `${AGENT_DISPLAY_NAMES[parentId] ?? parentId} II`,
    health: INITIAL_HEALTH,
    status: 'active',
    generation: parent.generation + 1,
    parentId,
    completedTasks: 0,
    failedTasks: 0,
    totalTokens: 0,
    skills: [...parent.skills], // AI: 继承父代技能
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }

  saveAgentStats(newStats)
  return newStats
}

// AI: 封禁后，基于父代经验生成替代 Agent
export function spawnReplacementAgent(bannedId: string): AgentStats {
  const banned = getAgentStats(bannedId)
  const baseId = bannedId.split('_g')[0] // AI: 提取基础角色 ID
  const newId = `${baseId}_g${banned.generation + 1}`

  ensureDir(agentDir(newId))
  ensureDir(agentTasksDir(newId))

  // AI: 继承 SOUL.md
  const bannedSoulPath = `${agentDir(bannedId)}/SOUL.md`
  if (fs.existsSync(bannedSoulPath)) {
    fs.copyFileSync(bannedSoulPath, `${agentDir(newId)}/SOUL.md`)
  }

  const newStats: AgentStats = {
    agentId: newId,
    displayName: `${AGENT_DISPLAY_NAMES[baseId] ?? baseId}（${banned.generation + 1}代）`,
    health: INITIAL_HEALTH,
    status: 'active',
    generation: banned.generation + 1,
    parentId: bannedId,
    completedTasks: 0,
    failedTasks: 0,
    totalTokens: 0,
    skills: [...banned.skills], // AI: 继承封禁代的技能
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  }

  saveAgentStats(newStats)
  return newStats
}

/* AI end: Agent 生命周期管理 */
