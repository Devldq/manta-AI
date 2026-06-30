/**
 * Skill 技能存储层 — 持久化 Skill 定义
 *
 * 存储结构：
 *   {workspace}/.manta/skills/
 *     └── {id}.json   — 每个 Skill 一个 JSON 文件
 */

import * as fs from 'fs'
import * as path from 'path'
import { ensureDir, atomicWrite, shortId, readJsonFile } from '../shared/fs-utils'
import type {
  SkillDefinition,
  SkillSummary,
  SkillMetadata,
  SkillParameter,
  CreateSkillInput,
  UpdateSkillInput,
} from '@manta/shared'

// ─── 存储路径 ─────────────────────────────────────────────────

/** 获取 Skill JSON 存储目录（项目内 .manta/skills/） */
function getDataDir(): string {
  const root = process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, '.manta', 'skills')
}

function skillFilePath(skillId: string): string {
  return path.join(getDataDir(), `${skillId}.json`)
}

// ─── 内部索引 ─────────────────────────────────────────────────

/** 从完整定义提取摘要 */
function toSummary(def: SkillDefinition): SkillSummary {
  return {
    id: def.id,
    name: def.metadata.name,
    description: def.metadata.description,
    type: def.metadata.type,
    version: def.metadata.version,
    source: def.metadata.source,
    enabled: def.enabled,
    boundAgents: def.boundAgents,
    createdAt: def.createdAt,
    updatedAt: def.updatedAt,
  }
}

// ─── CRUD 函数 ────────────────────────────────────────────────

/**
 * 获取所有 Skill 列表（按 updatedAt 倒序）
 */
export function listSkills(search?: string): SkillSummary[] {
  const dataDir = getDataDir()
  ensureDir(dataDir)
  const skills: SkillDefinition[] = []

  try {
    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(dataDir, file)
      try {
        const skill = readJsonFile<SkillDefinition>(fp)
        if (skill && skill.id && skill.metadata) {
          skills.push(skill)
        }
      } catch {
        // 跳过损坏的文件
      }
    }
  } catch {
    // 目录读取失败
  }

  let filtered = skills
  if (search) {
    const lower = search.toLowerCase()
    filtered = skills.filter(
      (s) =>
        s.metadata.name.toLowerCase().includes(lower) ||
        s.metadata.description.toLowerCase().includes(lower),
    )
  }

  return filtered
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
    .map(toSummary)
}

/**
 * 获取单个 Skill 完整定义
 */
export function getSkill(id: string): SkillDefinition | null {
  return readJsonFile<SkillDefinition>(skillFilePath(id))
}

/**
 * 创建新 Skill
 */
export function createSkill(input: CreateSkillInput): SkillDefinition {
  ensureDir(getDataDir())

  const id = `skill-${shortId()}`
  const now = new Date().toISOString()

  const def: SkillDefinition = {
    id,
    metadata: {
      name: input.metadata.name,
      description: input.metadata.description,
      version: input.metadata.version || '1.0.0',
      type: input.metadata.type,
      source: input.metadata.source || 'user',
      license: input.metadata.license,
      userInvocable: input.metadata.userInvocable ?? true,
      argumentHint: input.metadata.argumentHint,
    },
    content: input.content,
    parameters: input.parameters || [],
    boundAgents: [],
    tools: input.tools || [],
    filePath: skillFilePath(id),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }

  atomicWrite(skillFilePath(id), JSON.stringify(def, null, 2))
  return def
}

/**
 * 更新 Skill
 */
export function updateSkill(
  id: string,
  input: UpdateSkillInput,
): SkillDefinition | null {
  const existing = getSkill(id)
  if (!existing) return null

  const updated: SkillDefinition = {
    ...existing,
    metadata: input.metadata
      ? { ...existing.metadata, ...input.metadata }
      : existing.metadata,
    content: input.content ?? existing.content,
    parameters: input.parameters ?? existing.parameters,
    tools: input.tools ?? existing.tools,
    enabled: input.enabled ?? existing.enabled,
    id,
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(skillFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 删除 Skill
 */
export function deleteSkill(id: string): boolean {
  const fp = skillFilePath(id)
  try {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 启用/禁用 Skill
 */
export function toggleSkill(id: string, enabled: boolean): SkillDefinition | null {
  return updateSkill(id, { enabled })
}

/**
 * 绑定 Agent 到 Skill
 */
export function bindAgents(
  skillId: string,
  agentNames: string[],
): SkillDefinition | null {
  const existing = getSkill(skillId)
  if (!existing) return null

  const updated: SkillDefinition = {
    ...existing,
    boundAgents: agentNames,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(skillFilePath(skillId), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 根据名称查找 Skill
 */
export function findSkillByName(name: string): SkillDefinition | null {
  const dataDir = getDataDir()
  ensureDir(dataDir)
  try {
    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(dataDir, file)
      try {
        const skill = readJsonFile<SkillDefinition>(fp)
        if (skill && skill.metadata.name === name) {
          return skill
        }
      } catch {
        // 跳过
      }
    }
  } catch {
    // 读取失败
  }
  return null
}

/**
 * 获取 Agent 绑定的所有 Skill（按 agentName 查找）
 */
export function getSkillsForAgent(agentName: string): SkillDefinition[] {
  const dataDir = getDataDir()
  ensureDir(dataDir)
  const skills: SkillDefinition[] = []
  try {
    const files = fs.readdirSync(dataDir)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(dataDir, file)
      try {
        const skill = readJsonFile<SkillDefinition>(fp)
        if (
          skill &&
          skill.enabled &&
          skill.boundAgents?.includes(agentName)
        ) {
          skills.push(skill)
        }
      } catch {
        // 跳过
      }
    }
  } catch {
    // 读取失败
  }
  return skills
}
