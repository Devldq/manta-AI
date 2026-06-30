/**
 * Skill 文件扫描器 — 解析项目 skills/ 目录中的 SKILL.md 文件
 *
 * 支持解析 YAML frontmatter + Markdown body 格式的 Skill 定义文件
 */

import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'
import type { SkillType } from '@manta/shared'

// ─── 解析结果类型 ────────────────────────────────────────────

export interface ScannedSkill {
  /** Skill 名称（来自 YAML frontmatter name 字段） */
  name: string
  /** 描述 */
  description: string
  /** 版本 */
  version?: string
  /** 类型 */
  type: SkillType
  /** 来源 */
  source?: string
  /** 许可证 */
  license?: string
  /** 用户是否可手动调用 */
  userInvocable?: boolean
  /** 参数提示 */
  argumentHint?: string
  /** 指令内容（Markdown body） */
  content: string
  /** 允许的工具列表 */
  tools?: string[]
  /** 文件路径 */
  filePath: string
  /** 目录名（skill 文件夹名） */
  dirName: string
}

// ─── YAML 解析 ───────────────────────────────────────────────

/** 解析 YAML frontmatter，返回 metadata 和 body */
function parseFrontmatter(raw: string): { metadata: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return null

  try {
    const metadata = yaml.load(match[1]) as Record<string, unknown>
    return { metadata, body: match[2].trim() }
  } catch {
    return null
  }
}

/** 规范化类型字符串到 SkillType */
function normalizeType(t: unknown): SkillType {
  if (typeof t !== 'string') return 'tool'
  const lower = t.toLowerCase()
  if (lower === 'writing' || lower === '写作') return 'writing'
  if (lower === 'workflow' || lower === '流程') return 'workflow'
  return 'tool'
}

/** 扫描单个 SKILL.md 文件 */
function scanSkillFile(filePath: string, dirName: string): ScannedSkill | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = parseFrontmatter(raw)
    if (!parsed) return null

    const { metadata, body } = parsed

    // 必须有 name 和 description
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : ''
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : ''
    if (!name || !description) return null

    // 解析 allowed-tools
    let tools: string[] | undefined
    if (Array.isArray(metadata['allowed-tools'])) {
      tools = metadata['allowed-tools']
        .map((t: unknown) => {
          if (typeof t === 'string') {
            // 处理 "Bash(npx impeccable *)" 格式，提取工具名
            const match = t.match(/^([A-Za-z_]+)/)
            return match ? match[1].toLowerCase() : t.toLowerCase()
          }
          return ''
        })
        .filter(Boolean)
    }

    return {
      name,
      description,
      version: typeof metadata.version === 'string' ? metadata.version : undefined,
      type: normalizeType(metadata.type),
      source: typeof metadata.source === 'string' ? metadata.source : 'user',
      license: typeof metadata.license === 'string' ? metadata.license : undefined,
      userInvocable: metadata['user-invocable'] !== false && metadata.userInvocable !== false,
      argumentHint: typeof metadata['argument-hint'] === 'string'
        ? metadata['argument-hint']
        : typeof metadata.argumentHint === 'string'
          ? metadata.argumentHint
          : undefined,
      content: body,
      tools,
      filePath,
      dirName,
    }
  } catch {
    return null
  }
}

// ─── 目录扫描 ────────────────────────────────────────────────

/** 扫描 skills 根目录，找到所有 SKILL.md
 *  支持两种结构：
 *    skills/{name}/SKILL.md          — 标准结构
 *    skills/{category}/{name}/SKILL.md — 嵌套分类结构
 */
function findSkillFiles(rootDir: string): Array<{ filePath: string; dirName: string }> {
  const results: Array<{ filePath: string; dirName: string }> = []
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      // 跳过隐藏目录
      if (entry.name.startsWith('.')) continue

      const skillMdPath = path.join(rootDir, entry.name, 'SKILL.md')
      if (fs.existsSync(skillMdPath)) {
        // 标准结构：{name}/SKILL.md
        results.push({ filePath: skillMdPath, dirName: entry.name })
      } else {
        // 尝试嵌套结构：{category}/{name}/SKILL.md
        try {
          const subEntries = fs.readdirSync(path.join(rootDir, entry.name), { withFileTypes: true })
          for (const sub of subEntries) {
            if (!sub.isDirectory() || sub.name.startsWith('.')) continue
            const subMdPath = path.join(rootDir, entry.name, sub.name, 'SKILL.md')
            if (fs.existsSync(subMdPath)) {
              results.push({ filePath: subMdPath, dirName: sub.name })
            }
          }
        } catch {
          // 子目录读取失败，跳过
        }
      }
    }
  } catch {
    // 目录不存在或读取失败
  }
  return results
}

// ─── 公开接口 ────────────────────────────────────────────────

/** Skill 目录基础路径（项目根目录 skills/） */
export function getSkillsBaseDir(workspaceRoot?: string): string {
  // 通过环境变量或默认值获取 skills 目录
  const root = workspaceRoot || process.env.MANTA_WORKSPACE_ROOT || process.cwd()
  return path.join(root, 'skills')
}

/**
 * 扫描所有 SKILL.md 文件并返回解析结果
 * @param baseDir 可选，指定扫描的基础目录，默认使用 skills/ 目录
 */
export function scanSkillFiles(baseDir?: string): ScannedSkill[] {
  const dir = baseDir || getSkillsBaseDir()
  const files = findSkillFiles(dir)

  // 额外处理直接在 baseDir 下的 SKILL.md
  const directMd = path.join(dir, 'SKILL.md')
  if (fs.existsSync(directMd)) {
    files.push({ filePath: directMd, dirName: path.basename(dir) })
  }

  return files
    .map((f) => scanSkillFile(f.filePath, f.dirName))
    .filter((s): s is ScannedSkill => s !== null)
}

/**
 * 扫描并打印所有找到的 Skill（调试用）
 */
export function listScannedSkillNames(baseDir?: string): string[] {
  return scanSkillFiles(baseDir).map((s) => s.name)
}

/**
 * 检查 Skill 文件是否存在
 */
export function skillFileExists(name: string, baseDir?: string): boolean {
  const dir = baseDir || getSkillsBaseDir()
  const filePath = path.join(dir, name, 'SKILL.md')
  return fs.existsSync(filePath)
}

/**
 * 读取单个 Skill 文件的原始内容
 */
export function readSkillFileContent(name: string, baseDir?: string): string | null {
  const dir = baseDir || getSkillsBaseDir()
  const filePath = path.join(dir, name, 'SKILL.md')
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// ─── 大型 Skill 文件树浏览 ────────────────────────────────────

export interface SkillFileEntry {
  name: string
  /** 相对于 skill 根目录的路径 */
  path: string
  type: 'file' | 'directory'
  size?: number
  extension?: string
  children?: SkillFileEntry[]
}

/**
 * 递归列出 skill 目录下的所有文件
 * @param skillName skill 名称（目录名）
 */
export function listSkillFileTree(skillName: string, baseDir?: string): SkillFileEntry[] | null {
  const dir = baseDir || getSkillsBaseDir()
  const skillDir = path.join(dir, skillName)

  try {
    if (!fs.statSync(skillDir).isDirectory()) return null
  } catch {
    return null
  }

  function readDir(currentPath: string, relativeTo: string): SkillFileEntry[] {
    const entries: SkillFileEntry[] = []
    let dirEntries: fs.Dirent[]

    try {
      dirEntries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch {
      return entries
    }

    // 目录优先，文件其次
    const dirs = dirEntries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    const files = dirEntries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))

    for (const d of dirs) {
      const relPath = path.join(relativeTo, d.name)
      entries.push({
        name: d.name,
        path: relPath,
        type: 'directory',
        children: readDir(path.join(currentPath, d.name), relPath),
      })
    }

    for (const f of files) {
      const relPath = path.join(relativeTo, f.name)
      const ext = path.extname(f.name).slice(1) || undefined
      let size: number | undefined
      try {
        size = fs.statSync(path.join(currentPath, f.name)).size
      } catch { /* ignore */ }

      entries.push({
        name: f.name,
        path: relPath,
        type: 'file',
        size,
        extension: ext,
      })
    }

    return entries
  }

  return readDir(skillDir, '')
}

/**
 * 读取 skill 目录下指定文件的原始内容
 * @param skillName skill 名称（目录名）
 * @param relativePath 相对于 skill 目录的文件路径
 */
export function readSkillSubFile(skillName: string, relativePath: string, baseDir?: string): string | null {
  const dir = baseDir || getSkillsBaseDir()
  const filePath = path.join(dir, skillName, relativePath)

  // 安全检查：防止路径遍历
  const resolved = path.resolve(filePath)
  const skillDir = path.resolve(dir, skillName)
  if (!resolved.startsWith(skillDir)) return null

  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 写入 skill 目录下指定文件的内容
 * @returns 写入后的文件大小，失败返回 null
 */
export function writeSkillSubFile(
  skillName: string,
  relativePath: string,
  content: string,
  baseDir?: string,
): number | null {
  const dir = baseDir || getSkillsBaseDir()
  const filePath = path.join(dir, skillName, relativePath)

  // 安全检查：防止路径遍历
  const resolved = path.resolve(filePath)
  const skillDir = path.resolve(dir, skillName)
  if (!resolved.startsWith(skillDir)) return null

  try {
    const parentDir = path.dirname(filePath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    fs.writeFileSync(filePath, content, 'utf-8')
    return fs.statSync(filePath).size
  } catch {
    return null
  }
}
