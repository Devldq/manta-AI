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
import {
  scanSkillFiles,
  getSkillsBaseDir,
  skillFileExists as scannerSkillFileExists,
} from './scanner'
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

// ─── 启动初始化 & 动态加载 ─────────────────────────────────────

export interface InitializeSkillsResult {
  total: number
  imported: number
  updated: number
  skipped: number
  errors: Array<{ name: string; error: string }>
}

/**
 * 启动时自动扫描并导入 skills/ 目录中的 SKILL.md 文件
 *
 * 策略：
 *   - 新发现的 skill → 自动导入（create）
 *   - 已存在的 → 自动同步更新（以文件为准）
 */
export function initializeSkills(): InitializeSkillsResult {
  ensureDir(getDataDir())

  let scanned: ReturnType<typeof scanSkillFiles>
  try {
    scanned = scanSkillFiles()
  } catch {
    return { total: 0, imported: 0, updated: 0, skipped: 0, errors: [] }
  }

  const allStored = listSkills()
  const storedByName = new Map(allStored.map((s) => [s.name, s]))

  const result: InitializeSkillsResult = {
    total: scanned.length,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  for (const scannedSkill of scanned) {
    try {
      const existing = storedByName.get(scannedSkill.name)

      if (!existing) {
        createSkill({
          metadata: {
            name: scannedSkill.name,
            description: scannedSkill.description,
            version: scannedSkill.version || '1.0.0',
            type: scannedSkill.type,
            source: (scannedSkill.source as SkillMetadata['source']) || 'file',
            license: scannedSkill.license,
            userInvocable: scannedSkill.userInvocable ?? true,
            argumentHint: scannedSkill.argumentHint,
          },
          content: scannedSkill.content,
          tools: scannedSkill.tools,
        })
        result.imported++
      } else {
        updateSkill(existing.id, {
          metadata: {
            description: scannedSkill.description,
            version: scannedSkill.version || existing.metadata.version,
            type: scannedSkill.type,
            source: existing.metadata.source || 'file',
            license: scannedSkill.license ?? existing.metadata.license,
            userInvocable: scannedSkill.userInvocable ?? existing.metadata.userInvocable,
            argumentHint: scannedSkill.argumentHint ?? existing.metadata.argumentHint,
          },
          content: scannedSkill.content,
          tools: scannedSkill.tools ?? existing.tools,
        })
        result.updated++
      }
    } catch (err) {
      result.errors.push({ name: scannedSkill.name, error: String(err) })
    }
  }

  return result
}

export interface CreateAndImportInput {
  name: string
  description: string
  type: SkillType
  content: string
  tools?: string[]
  version?: string
  license?: string
  argumentHint?: string
}

export interface CreateAndImportResult {
  success: boolean
  skill?: SkillDefinition
  filePath?: string
  error?: string
}

/**
 * 动态创建 Skill：写入 SKILL.md 到 skills/ 目录并立即导入到管理系统
 *
 * 用途：AI 动态生成新 skill 后调用此函数完成「写文件 + 入库」一步到位
 */
export function createAndImportSkill(input: CreateAndImportInput): CreateAndImportResult {
  const skillsDir = getSkillsBaseDir()
  const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const skillDir = path.join(skillsDir, safeName)
  const mdPath = path.join(skillDir, 'SKILL.md')

  try {
    ensureDir(skillDir)

    const frontmatter = [
      '---',
      `name: ${safeName}`,
      `description: ${input.description}`,
      `type: ${input.type}`,
      ...(input.version ? [`version: ${input.version}`] : []),
      ...(input.license ? [`license: ${input.license}`] : []),
      ...(input.argumentHint ? [`argument-hint: ${input.argumentHint}`] : []),
      ...(input.tools?.length ? [`allowed-tools:\n${input.tools.map((t) => `  - ${t}`).join('\n')}`] : []),
      '---',
      '',
      input.content,
    ].join('\n')

    fs.writeFileSync(mdPath, frontmatter, 'utf-8')

    // 检查是否已存在同名 skill
    const existing = findSkillByName(safeName)
    if (existing) {
      const updated = updateSkill(existing.id, {
        metadata: {
          description: input.description,
          type: input.type,
          version: input.version || existing.metadata.version,
          license: input.license,
          argumentHint: input.argumentHint,
        },
        content: input.content,
        tools: input.tools,
      })
      return { success: true, skill: updated, filePath: mdPath }
    }

    // 新建导入
    const skill = createSkill({
      metadata: {
        name: safeName,
        description: input.description,
        type: input.type,
        version: input.version || '1.0.0',
        source: 'ai-generated',
        license: input.license,
        userInvocable: true,
        argumentHint: input.argumentHint,
      },
      content: input.content,
      tools: input.tools,
    })

    return { success: true, skill, filePath: mdPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
