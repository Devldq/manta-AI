/* 文件系统工具集 — 供 AI 模型通过 function calling 使用
 * 安全限制：CWD 内自由访问；CWD 外需用户授权 */
import { tool, jsonSchema } from 'ai'
import * as fs from 'fs'
import * as path from 'path'
import { isApproved, requestAccess, listPendingRequests } from '@/core/fs/access-store'

/**
 * 解析路径并检查授权：
 * - 已授权 → 返回 resolved 路径
 * - 未授权 → 发起授权请求，轮询等待（最多 120s），授权后继续；超时或拒绝返回 error
 */
async function checkAccess(targetPath: string): Promise<{ resolved: string } | { error: string }> {
  const resolved = path.resolve(targetPath)
  if (isApproved(resolved)) {
    return { resolved }
  }

  const req = requestAccess(resolved)

  // 轮询等待用户授权，每 500ms 检查一次，最多等 120s
  const timeout = 120_000
  const interval = 500
  const start = Date.now()

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, interval))
    if (isApproved(resolved)) {
      return { resolved }
    }
    // 检查是否被拒绝（请求已从 pending 中移除但未被批准）
    const stillPending = listPendingRequests().some((r) => r.id === req.id)
    if (!stillPending && !isApproved(resolved)) {
      return { error: `用户拒绝了对 "${resolved}" 的访问请求` }
    }
  }

  return { error: `等待授权超时（120s），无法访问 "${resolved}"` }
}

/** 递归收集目录下所有文件（供 glob/grep 使用） */
function walkFiles(dir: string, result: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue // 跳过隐藏文件/目录
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, result)
    } else if (entry.isFile()) {
      result.push(full)
    }
  }
  return result
}

/** 将 glob 模式转为 RegExp（支持 * ** ? 三种通配符） */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义正则特殊字符（排除 * ?）
    .replace(/\*\*/g, '\x00DOUBLESTAR\x00') // 临时占位
    .replace(/\*/g, '[^/]*')
    .replace(/\x00DOUBLESTAR\x00/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** 读取文件内容 */
export const readFileTool = tool({
  description:
    '读取指定路径的文件内容。支持按行号范围截取，适合读取大文件的局部内容。CWD 外的路径需用户授权。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ file_path: string; offset?: number; limit?: number }>({
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件绝对路径或相对于 CWD 的路径' },
      offset: { type: 'integer', minimum: 1, description: '起始行号（从 1 开始），默认从第 1 行开始' },
      limit: { type: 'integer', minimum: 1, description: '最多读取的行数，默认读取全部' },
    },
    required: ['file_path'],
  }),
  execute: async ({ file_path, offset, limit }) => {
    const access = await checkAccess(file_path)
    if ('error' in access) return { error: access.error }
    const { resolved } = access

    if (!fs.existsSync(resolved)) {
      return { error: `文件不存在：${resolved}` }
    }
    const stat = fs.statSync(resolved)
    if (!stat.isFile()) {
      return { error: `路径不是文件：${resolved}` }
    }

    const raw = fs.readFileSync(resolved, 'utf-8')
    const lines = raw.split('\n')
    const totalLines = lines.length

    const start = Math.max((offset ?? 1) - 1, 0)
    const end = limit !== undefined ? Math.min(start + limit, totalLines) : totalLines
    const sliced = lines.slice(start, end)

    return {
      file_path: resolved,
      totalLines,
      offset: start + 1,
      limit: sliced.length,
      content: sliced.join('\n'),
    }
  },
})

/** 列出目录内容 */
export const lsDirTool = tool({
  description:
    '列出指定目录下的文件和子目录。CWD 外的路径需用户授权。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ dir_path: string }>({
    type: 'object',
    properties: {
      dir_path: { type: 'string', description: '目录绝对路径或相对于 CWD 的路径' },
    },
    required: ['dir_path'],
  }),
  execute: async ({ dir_path }) => {
    const access = await checkAccess(dir_path)
    if ('error' in access) return { error: access.error }
    const { resolved } = access

    if (!fs.existsSync(resolved)) {
      return { error: `目录不存在：${resolved}` }
    }
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return { error: `路径不是目录：${resolved}` }
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file',
    }))

    return { dir_path: resolved, count: items.length, items }
  },
})

/** 按 glob 模式匹配文件 */
export const globTool = tool({
  description:
    '按 glob 模式匹配文件，支持 * ** ? 通配符（如 "**/*.ts"、"src/**/*.tsx"）。CWD 外的搜索根目录需用户授权。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{ pattern: string; path?: string }>({
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts 或 src/**/*.tsx' },
      path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
    },
    required: ['pattern'],
  }),
  execute: async ({ pattern, path: searchPath }) => {
    const rootRaw = searchPath ?? process.cwd()
    const access = await checkAccess(rootRaw)
    if ('error' in access) return { error: access.error }
    const { resolved: root } = access
    if (!fs.existsSync(root)) {
      return { error: `目录不存在：${root}` }
    }

    const re = globToRegExp(pattern)
    const allFiles = walkFiles(root)
    const matched = allFiles
      .map((f) => path.relative(root, f))
      .filter((rel) => re.test(rel))
      .sort()

    return {
      pattern,
      root,
      count: matched.length,
      files: matched,
    }
  },
})

/** 在文件内容中搜索正则模式 */
export const grepTool = tool({
  description:
    '在指定目录的文件中搜索匹配正则表达式的行，支持文件类型过滤。返回匹配行的文件路径、行号和内容（最多 250 条）。CWD 外的搜索路径需用户授权。',
  // AI: parameters → inputSchema（AI SDK v6 API 变更）
  inputSchema: jsonSchema<{
    pattern: string
    search_path?: string
    include?: string
    ignore_case?: boolean
  }>({
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式，如 "function\\s+\\w+" 或 "import.*from"' },
      search_path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
      include: { type: 'string', description: '文件名过滤 glob，如 "*.ts" 或 "**/*.tsx"' },
      ignore_case: { type: 'boolean', description: '是否忽略大小写，默认 false' },
    },
    required: ['pattern'],
  }),
  execute: async ({ pattern, search_path, include, ignore_case }) => {
    const rootRaw = search_path ?? process.cwd()
    const access = await checkAccess(rootRaw)
    if ('error' in access) return { error: access.error }
    const { resolved: root } = access
    if (!fs.existsSync(root)) {
      return { error: `目录不存在：${root}` }
    }

    let re: RegExp
    try {
      re = new RegExp(pattern, ignore_case ? 'i' : undefined)
    } catch {
      return { error: `正则表达式无效：${pattern}` }
    }

    // 文件过滤
    let fileRe: RegExp | null = null
    if (include) {
      fileRe = globToRegExp(include)
    }

    const allFiles = walkFiles(root)
    const filteredFiles = fileRe
      ? allFiles.filter((f) => fileRe!.test(path.basename(f)))
      : allFiles

    const results: Array<{ file: string; line: number; content: string }> = []
    const MAX = 250

    outer: for (const file of filteredFiles) {
      let text: string
      try {
        text = fs.readFileSync(file, 'utf-8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push({
            file: path.relative(root, file),
            line: i + 1,
            content: lines[i].slice(0, 500), // 每行最多 500 字符
          })
          if (results.length >= MAX) break outer
        }
      }
    }

    return {
      pattern,
      root,
      total: results.length,
      truncated: results.length >= MAX,
      results,
    }
  },
})

/** 导出所有文件系统工具，便于批量注入 streamText */
export const fsTools = {
  readFile: readFileTool,
  lsDir: lsDirTool,
  glob: globTool,
  grep: grepTool,
}