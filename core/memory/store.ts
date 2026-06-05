/* MemoryStore — 记忆系统存储层
 *
 * 架构：MEMORY.md 索引 + 独立 .md 文件（YAML frontmatter 格式）
 * 存储路径：~/.manta-data/memory/
 *
 * 硬性约束：
 * - MAX_INDEX_LINES = 200  — 索引最多 200 行，低价值记忆自然淘汰
 * - MAX_FILE_CHARS = 4000 — 单文件最大 4000 字符，超限截断
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { MemoryEntry, MemoryType, IndexEntry } from './types'

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const MEMORY_DIR = path.join(os.homedir(), '.manta-data', 'memory')
const INDEX_FILE = 'MEMORY.md'
const MAX_INDEX_LINES = 200
const MAX_FILE_CHARS = 4000

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/** 生成文件名 slug：中文/英文/数字保留，其他字符替换为连字符 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-')
}

/** 简单 YAML frontmatter 解析器 — 只解析顶层字符串字段 */
function parseFrontmatter(
  content: string,
): { headers: Record<string, string>; body: string } | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return null

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return null

  const fmBlock = trimmed.slice(3, endIdx).trim()
  const body = trimmed.slice(endIdx + 3).trim()
  const headers: Record<string, string> = {}

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    headers[key] = value
  }

  return { headers, body }
}

// ─── MemoryStore 类 ────────────────────────────────────────────────────────────

export class MemoryStore {
  private readonly baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? MEMORY_DIR
  }

  private get memoryDir(): string {
    return path.join(this.baseDir)
  }

  private get indexPath(): string {
    return path.join(this.memoryDir, INDEX_FILE)
  }

  /** 初始化记忆目录和索引文件 */
  init(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true })
    }
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, '# Memory Index\n', 'utf-8')
    }
  }

  // ─── 索引管理 ────────────────────────────────────────────────────────────────

  /** 读取索引文件，解析为 IndexEntry 列表 */
  private readIndex(): IndexEntry[] {
    if (!fs.existsSync(this.indexPath)) return []

    const lines = fs.readFileSync(this.indexPath, 'utf-8').split('\n')
    const entries: IndexEntry[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      // 跳过标题和空行
      if (trimmed.startsWith('#') || trimmed.length === 0) continue
      // 格式: name | filename | description
      const parts = trimmed.split('|').map(p => p.trim())
      if (parts.length >= 2) {
        entries.push({
          name: parts[0],
          filename: parts[1],
          description: parts[2] ?? '',
        })
      }
    }

    return entries
  }

  /** 更新索引：已存在同名条目则覆盖，否则追加到头部。超 200 行时移除最早条目 */
  private updateIndex(name: string, filename: string, description: string): void {
    const entries = this.readIndex()

    // 移除同名旧条目
    const filtered = entries.filter(e => e.name !== name)

    // 新条目插入头部
    filtered.unshift({ name, filename, description })

    // 截断到 MAX_INDEX_LINES
    const truncated = filtered.slice(0, MAX_INDEX_LINES)

    // 重建索引内容
    const lines = ['# Memory Index']
    for (const e of truncated) {
      lines.push(`${e.name} | ${e.filename} | ${e.description}`)
    }

    // 原子写入
    const content = lines.join('\n') + '\n'
    const tmp = `${this.indexPath}.tmp`
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, this.indexPath)
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  /** 保存记忆条目：写文件 + 更新索引。返回生成的文件名 */
  save(entry: Omit<MemoryEntry, 'filePath'>): string {
    this.init()

    const slug = slugify(entry.name)
    const filename = `${entry.type}_${slug}.md`
    const filePath = path.join(this.memoryDir, filename)

    // 截断超长内容
    let content = entry.content
    if (content.length > MAX_FILE_CHARS) {
      content = content.slice(0, MAX_FILE_CHARS)
    }

    // YAML frontmatter + Markdown body
    const fileContent = [
      '---',
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `type: ${entry.type}`,
      '---',
      '',
      content,
    ].join('\n')

    // 原子写入
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, fileContent, 'utf-8')
    fs.renameSync(tmp, filePath)

    this.updateIndex(entry.name, filename, entry.description)

    return filename
  }

  /** 列出所有记忆条目 */
  list(): MemoryEntry[] {
    this.init()

    const entries: MemoryEntry[] = []
    let files: string[]
    try {
      files = fs.readdirSync(this.memoryDir)
        .filter(f => f.endsWith('.md') && f !== INDEX_FILE)
    } catch {
      return []
    }

    for (const filename of files) {
      const filePath = path.join(this.memoryDir, filename)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        // 读取时截断超长内容
        const displayContent = raw.length > MAX_FILE_CHARS
          ? raw.slice(0, MAX_FILE_CHARS)
          : raw

        const parsed = parseFrontmatter(displayContent)
        if (!parsed) continue

        entries.push({
          name: parsed.headers.name ?? filename,
          description: parsed.headers.description ?? '',
          type: (parsed.headers.type as MemoryType) ?? 'reference',
          content: parsed.body,
          filePath,
        })
      } catch {
        // 跳过损坏的文件
        continue
      }
    }

    return entries
  }

  /** 按名称查找单条记忆 */
  get(name: string): MemoryEntry | null {
    const all = this.list()
    return all.find(e => e.name === name) ?? null
  }

  /** 关键词搜索 — 在 name、description、content 中匹配 */
  search(query: string): MemoryEntry[] {
    const all = this.list()
    const keywords = query.toLowerCase().split(/\s+/)

    return all.filter(entry => {
      const text = `${entry.name} ${entry.description} ${entry.content}`.toLowerCase()
      return keywords.some(kw => text.includes(kw))
    })
  }

  /** 删除指定记忆（按名称） */
  delete(name: string): boolean {
    this.init()

    const entry = this.get(name)
    if (!entry) return false

    // 删除文件
    try {
      fs.unlinkSync(entry.filePath)
    } catch {
      return false
    }

    // 从索引中移除
    const entries = this.readIndex().filter(e => e.name !== name)
    const lines = ['# Memory Index']
    for (const e of entries) {
      lines.push(`${e.name} | ${e.filename} | ${e.description}`)
    }

    const content = lines.join('\n') + '\n'
    const tmp = `${this.indexPath}.tmp`
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, this.indexPath)

    return true
  }

  /** 清空所有记忆（删除记忆目录） */
  clear(): void {
    if (fs.existsSync(this.memoryDir)) {
      const removeDir = (dir: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            removeDir(full)
          } else {
            fs.unlinkSync(full)
          }
        }
        fs.rmdirSync(dir)
      }
      removeDir(this.memoryDir)
    }
  }

  // ─── Prompt 注入 ──────────────────────────────────────────────────────────────

  /**
   * 构建记忆上下文片段，供 Prompt Pipe 注入到 system prompt。
   *
   * 设计要点：
   * - 只注入索引摘要（name + description），不注入完整内容——token 友好
   * - 附带使用提示：通过 memory 工具读取具体内容，使用前先验证
   * - "记忆是线索，不是事实" — 代码路径和行号可能已过时
   */
  buildPromptSection(): string {
    this.init()

    const entries = this.list()

    if (entries.length === 0) {
      return '[记忆系统] 当前没有存储任何记忆。你可以使用 memory 工具来保存重要信息（action: save）。'
    }

    const lines = [
      `[记忆系统] 共 ${entries.length} 条跨会话记忆`,
      '',
      ...entries.map(
        (e, i) => `${i + 1}. [${e.type}] ${e.name}: ${e.description}`,
      ),
      '',
      '使用 memory 工具的 read 操作来读取具体记忆内容。',
      '记忆是线索，不是事实——使用前先验证其准确性。代码路径和行号引用可能已过时。',
    ]

    return lines.join('\n')
  }
}
