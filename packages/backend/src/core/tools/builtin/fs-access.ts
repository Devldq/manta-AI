/* core/tools/fs-access — 文件系统工具集（带访问控制）
 *
 * 工具列表：
 * - readFile — 读取文件内容（需授权 CWD 外路径）
 * - lsDir   — 列出目录内容
 * - glob    — 按 glob 模式匹配文件
 * - grep    — 在文件内容中搜索正则模式
 */
import type { ToolDefinition } from '@tools/registry'
import * as fs from 'fs'
import * as path from 'path'
import { getDefaultWorkDir } from '@storage/config/workspace-store'
import { parseInput, extractFilePath, extractDirPath, globToRegExp, walkFiles, checkAccess } from './utils'

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** readFile — 读取文件内容 */
function createReadFileTool(): ToolDefinition {
  return {
    name: 'readFile',
    description: '读取指定路径的文件内容。支持按行号范围截取，适合读取大文件的局部内容。CWD 外的路径需用户授权。',
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
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'read file content view inspect text lines',
    execute: async (input: any) => {
      const params = parseInput(input)
      const filePath = extractFilePath(params)
      const { offset, limit } = params as any
      if (!filePath) return { error: '缺少文件路径参数' }
      const access = await checkAccess(filePath)
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
  }
}

/** lsDir — 列出目录内容 */
function createLsDirTool(): ToolDefinition {
  return {
    name: 'lsDir',
    description: '列出指定目录下的文件和子目录。CWD 外的路径需用户授权。',
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
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'list directory folder files browse entries ls dir',
    execute: async (input: any) => {
      const params = parseInput(input)
      const targetPath = extractDirPath(params)
      if (!targetPath) return { error: '缺少目录路径参数' }
      const access = await checkAccess(targetPath)
      if ('error' in access) return { error: access.error }
      const { resolved } = access

      if (!fs.existsSync(resolved)) {
        return { error: `目录不存在：${resolved}` }
      }
      const stat = fs.statSync(resolved)
      if (!stat.isDirectory()) {
        return { error: `路径不是目录：${resolved}` }
      }

      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(resolved, { withFileTypes: true })
      } catch (err) {
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
}

/** glob — 按 glob 模式匹配文件 */
function createGlobTool(): ToolDefinition {
  return {
    name: 'glob',
    description: '按 glob 模式匹配文件，支持 * ** ? 通配符（如 "**/*.ts"、"src/**/*.tsx"）。CWD 外的搜索根目录需用户授权。',
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
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'find files pattern glob search match wildcard',
    execute: async (input: any) => {
      const params = parseInput(input)
      const { pattern, search_path, root: rootParam, path: searchPath } = params as any
      const rootRaw = searchPath ?? search_path ?? rootParam ?? getDefaultWorkDir()
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
}

/** grep — 在文件内容中搜索正则模式 */
function createGrepTool(): ToolDefinition {
  return {
    name: 'grep',
    description: '在指定目录的文件中搜索匹配正则表达式的行，支持文件类型过滤。返回匹配行的文件路径、行号和内容（最多 250 条）。CWD 外的搜索路径需用户授权。',
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
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'search text content regex pattern match find grep',
    execute: async (input: any) => {
      const params = parseInput(input)
      const { pattern, search_path, path: pathParam, root: rootParam, include, ignore_case, case_insensitive } = params as any
      const rootRaw = search_path ?? pathParam ?? rootParam ?? getDefaultWorkDir()
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
              content: lines[i].slice(0, 500),
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
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有带访问控制的文件系统工具 */
export function createFsTools(): ToolDefinition[] {
  return [
    createReadFileTool(),
    createLsDirTool(),
    createGlobTool(),
    createGrepTool(),
  ]
}
