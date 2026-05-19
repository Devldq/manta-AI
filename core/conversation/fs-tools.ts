/* 文件系统工具集 — 使用 ToolDefinition 接口定义，供 ToolRegistry 管理
 * 安全限制：CWD 内自由访问；CWD 外需用户授权 */
import type { ToolDefinition } from '@/core/tool-registry'
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
  console.log(`[fs-tools] checkAccess: ${targetPath} → ${resolved}`)
  console.log(`[fs-tools] isApproved: ${isApproved(resolved)}`)

  if (isApproved(resolved)) {
    console.log(`[fs-tools] ✓ 已授权，直接访问`)
    return { resolved }
  }

  console.log(`[fs-tools] 需要授权，发起请求...`)
  const req = requestAccess(resolved)
  console.log(`[fs-tools] 授权请求已创建: ${req.id}`)

  // 轮询等待用户授权，每 500ms 检查一次，最多等 120s
  const timeout = 120_000
  const interval = 500
  const start = Date.now()

  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, interval))
    if (isApproved(resolved)) {
      console.log(`[fs-tools] ✓ 授权已批准`)
      return { resolved }
    }
    // 检查是否被拒绝（请求已从 pending 中移除但未被批准）
    const stillPending = listPendingRequests().some((r) => r.id === req.id)
    if (!stillPending && !isApproved(resolved)) {
      console.log(`[fs-tools] ✗ 用户拒绝访问`)
      return { error: `用户拒绝了对 "${resolved}" 的访问请求` }
    }
  }

  console.log(`[fs-tools] ✗ 授权超时`)
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
const readFileDef: ToolDefinition = {
  name: 'readFile',
  description:
    '读取指定路径的文件内容。支持按行号范围截取，适合读取大文件的局部内容。CWD 外的路径需用户授权。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件绝对路径或相对于 CWD 的路径' },
      path: { type: 'string', description: '文件路径（同 file_path）' },
      file: { type: 'string', description: '文件路径（同 file_path）' },
      filename: { type: 'string', description: '文件路径（同 file_path）' },
      offset: { type: 'integer', minimum: 1, description: '起始行号（从 1 开始），默认从第 1 行开始' },
      limit: { type: 'integer', minimum: 1, description: '最多读取的行数，默认读取全部' },
    },
    additionalProperties: true,
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    console.log(`[fs-tools:readFile] 开始执行`)
    const { file_path, path: pathParam, file, filename, offset, limit } = input
    const filePath = file_path || pathParam || file || filename || ''
    console.log(`[fs-tools:readFile] filePath: ${filePath}`)
    if (!filePath) return { error: '缺少文件路径参数' }
    const access = await checkAccess(filePath)
    if ('error' in access) return { error: access.error }
    const { resolved } = access
    console.log(`[fs-tools:readFile] resolved: ${resolved}`)

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
    console.log(`[fs-tools:readFile] 文件总行数: ${totalLines}`)

    const start = Math.max((offset ?? 1) - 1, 0)
    const end = limit !== undefined ? Math.min(start + limit, totalLines) : totalLines
    const sliced = lines.slice(start, end)
    console.log(`[fs-tools:readFile] 返回行数: ${sliced.length} (offset: ${start + 1}, limit: ${end - start})`)

    return {
      file_path: resolved,
      totalLines,
      offset: start + 1,
      limit: sliced.length,
      content: sliced.join('\n'),
    }
  },
}

/** 列出目录内容 */
const lsDirDef: ToolDefinition = {
  name: 'lsDir',
  description:
    '列出指定目录下的文件和子目录。CWD 外的路径需用户授权。',
  parameters: {
    type: 'object',
    properties: {
      dir_path: { type: 'string', description: '目录绝对路径或相对于 CWD 的路径' },
      path: { type: 'string', description: '目录路径（同 dir_path）' },
      dir: { type: 'string', description: '目录路径（同 dir_path）' },
      directory: { type: 'string', description: '目录路径（同 dir_path）' },
    },
    additionalProperties: true,
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    console.log(`[fs-tools:lsDir] 开始执行`)
    const { dir_path, path: pathParam, dir, directory } = input
    // 容错：取第一个非空值作为目录路径
    const targetPath = dir_path || pathParam || dir || directory || ''
    console.log(`[fs-tools:lsDir] targetPath: ${targetPath}`)
    if (!targetPath) return { error: '缺少目录路径参数' }
    const access = await checkAccess(targetPath)
    if ('error' in access) return { error: access.error }
    const { resolved } = access
    console.log(`[fs-tools:lsDir] resolved: ${resolved}`)

    console.log(`[fs-tools:lsDir] existsSync: ${fs.existsSync(resolved)}`)
    if (!fs.existsSync(resolved)) {
      return { error: `目录不存在：${resolved}` }
    }
    console.log(`[fs-tools:lsDir] 调用 statSync...`)
    const stat = fs.statSync(resolved)
    console.log(`[fs-tools:lsDir] isDirectory: ${stat.isDirectory()}`)
    if (!stat.isDirectory()) {
      return { error: `路径不是目录：${resolved}` }
    }

    console.log(`[fs-tools:lsDir] 调用 readdirSync...`)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(resolved, { withFileTypes: true })
      console.log(`[fs-tools:lsDir] readdirSync 成功，条目数: ${entries.length}`)
    } catch (err) {
      console.log(`[fs-tools:lsDir] readdirSync 失败: ${err}`)
      return { error: `无法读取目录 "${resolved}"：${err instanceof Error ? err.message : String(err)}` }
    }

    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file',
    }))

    if (items.length === 0) {
      return {
        dir_path: resolved,
        count: 0,
        items: [],
        message: `目录 "${resolved}" 是空的`,
      }
    }

    return { dir_path: resolved, count: items.length, items }
  },
}

/** 按 glob 模式匹配文件 */
const globDef: ToolDefinition = {
  name: 'glob',
  description:
    '按 glob 模式匹配文件，支持 * ** ? 通配符（如 "**/*.ts"、"src/**/*.tsx"）。CWD 外的搜索根目录需用户授权。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts 或 src/**/*.tsx' },
      path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
      search_path: { type: 'string', description: '搜索根目录（同 path）' },
      root: { type: 'string', description: '搜索根目录（同 path）' },
    },
    required: ['pattern'],
    additionalProperties: true,
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    console.log(`[fs-tools:glob] 开始执行`)
    const { pattern, path: searchPath, search_path, root: rootParam } = input
    console.log(`[fs-tools:glob] pattern: ${pattern}, searchPath: ${searchPath ?? search_path ?? rootParam ?? 'cwd'}`)
    const rootRaw = searchPath ?? search_path ?? rootParam ?? process.cwd()
    const access = await checkAccess(rootRaw)
    if ('error' in access) return { error: access.error }
    const { resolved: root } = access
    console.log(`[fs-tools:glob] resolved root: ${root}`)
    if (!fs.existsSync(root)) {
      return { error: `目录不存在：${root}` }
    }

    const re = globToRegExp(pattern)
    console.log(`[fs-tools:glob] 开始 walkFiles...`)
    const allFiles = walkFiles(root)
    console.log(`[fs-tools:glob] walkFiles 完成，总文件数: ${allFiles.length}`)
    const matched = allFiles
      .map((f) => path.relative(root, f))
      .filter((rel) => re.test(rel))
      .sort()
    console.log(`[fs-tools:glob] 匹配结果数: ${matched.length}`)

    if (matched.length === 0) {
      return {
        pattern,
        root,
        count: 0,
        files: [],
        message: `没有找到匹配 "${pattern}" 的文件`,
      }
    }

    return {
      pattern,
      root,
      count: matched.length,
      files: matched,
    }
  },
}

/** 在文件内容中搜索正则模式 */
const grepDef: ToolDefinition = {
  name: 'grep',
  description:
    '在指定目录的文件中搜索匹配正则表达式的行，支持文件类型过滤。返回匹配行的文件路径、行号和内容（最多 250 条）。CWD 外的搜索路径需用户授权。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式，如 "function\\s+\\w+" 或 "import.*from"' },
      search_path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
      path: { type: 'string', description: '搜索根目录（同 search_path）' },
      root: { type: 'string', description: '搜索根目录（同 search_path）' },
      include: { type: 'string', description: '文件名过滤 glob，如 "*.ts" 或 "**/*.tsx"' },
      ignore_case: { type: 'boolean', description: '是否忽略大小写，默认 false' },
      case_insensitive: { type: 'boolean', description: '是否忽略大小写（同 ignore_case）' },
    },
    required: ['pattern'],
    additionalProperties: true,
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { pattern, search_path, path: pathParam, root: rootParam, include, ignore_case, case_insensitive } = input
    const rootRaw = search_path ?? pathParam ?? rootParam ?? process.cwd()
    const ignoreCaseFinal = ignore_case ?? case_insensitive ?? false
    const access = await checkAccess(rootRaw)
    if ('error' in access) return { error: access.error }
    const { resolved: root } = access
    if (!fs.existsSync(root)) {
      return { error: `目录不存在：${root}` }
    }

    let re: RegExp
    try {
      re = new RegExp(pattern, ignoreCaseFinal ? 'i' : undefined)
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

    if (results.length === 0) {
      return {
        pattern,
        root,
        total: 0,
        truncated: false,
        results: [],
        message: `没有找到匹配正则 "${pattern}" 的内容`,
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
}

/** 导出所有文件系统工具定义，供 ToolRegistry 注册 */
export const fsToolDefs: ToolDefinition[] = [
  readFileDef,
  lsDirDef,
  globDef,
  grepDef,
]
