/* Claude Code (CC) 工具集 — 使用 ToolDefinition 接口定义，供 ToolRegistry 管理
 * 工具列表参考：https://code.claude.com/docs/zh-CN/tools-reference
 * 包含：Bash / Read / Write / Edit / MultiEdit / Glob / Grep / WebFetch / WebSearch / TodoRead / TodoWrite */
import type { ToolDefinition } from '@/core/tool-registry'
import * as fs from 'fs'
import * as path from 'path'
import * as child_process from 'child_process'
import * as os from 'os'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
}

// ─── Todo 持久化存储（内存 + 文件） ──────────────────────────────────────────

const TODO_FILE = path.join(os.homedir(), '.manta-data', 'todos.json')

function readTodos(): TodoItem[] {
  try {
    if (fs.existsSync(TODO_FILE)) {
      return JSON.parse(fs.readFileSync(TODO_FILE, 'utf-8'))
    }
  } catch {
    // 忽略解析错误
  }
  return []
}

function writeTodos(todos: TodoItem[]): void {
  const dir = path.dirname(TODO_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2), 'utf-8')
}

// ─── 后台任务注册表（task_id → process 信息）─────────────────────────────────

interface BashTask {
  task_id: string
  command: string
  startedAt: number
  status: 'running' | 'completed' | 'failed'
  stdout: string
  stderr: string
  exitCode: number | null
}

const bashTaskRegistry = new Map<string, BashTask>()
let bashTaskCounter = 0

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** Bash — 在持久 Shell 会话中执行命令 */
const bashDef: ToolDefinition = {
  name: 'bash',
  description: '在 shell 中执行命令。支持超时设置和后台运行。避免使用 find、grep、cat、head、tail、sed、awk 等命令，优先使用专用工具（Read/Grep/Glob）。',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 shell 命令' },
      description: { type: 'string', description: '命令的简短描述（3-10 个词）' },
      timeout: {
        type: 'integer',
        minimum: 0,
        maximum: 600000,
        description: '超时时间（毫秒），默认 120000ms，最大 600000ms',
      },
      run_in_background: {
        type: 'boolean',
        description: '是否后台运行，返回 task_id 供后续查询',
      },
    },
    required: ['command'],
  },
  isConcurrencySafe: false, // bash 可能修改任何文件，需要串行执行
  execute: async (input: any) => {
    const { command, timeout = 120000, run_in_background = false } = input
    if (run_in_background) {
      const task_id = `bash_${++bashTaskCounter}_${Date.now()}`
      const task: BashTask = {
        task_id,
        command,
        startedAt: Date.now(),
        status: 'running',
        stdout: '',
        stderr: '',
        exitCode: null,
      }
      bashTaskRegistry.set(task_id, task)

      const proc = child_process.exec(command, { timeout })
      proc.stdout?.on('data', (d: string) => { task.stdout += d })
      proc.stderr?.on('data', (d: string) => { task.stderr += d })
      proc.on('close', (code: number | null) => {
        task.status = code === 0 ? 'completed' : 'failed'
        task.exitCode = code
      })

      return { task_id, status: 'running', message: `命令已在后台启动，task_id: ${task_id}` }
    }

    return new Promise<{ command: string; stdout: string; stderr: string; exitCode: number | null; error?: string }>((resolve) => {
      child_process.exec(command, { timeout }, (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          resolve({ command, stdout, stderr, exitCode: null, error: `命令超时（${timeout}ms）` })
          return
        }
        resolve({
          command,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 10000),
          exitCode: err?.code ?? 0,
        })
      })
    })
  },
}

/** BashOutput — 获取后台 Bash 任务的输出 */
const bashOutputDef: ToolDefinition = {
  name: 'bashOutput',
  description: '获取后台运行的 Bash 任务的当前输出和状态。',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: '后台任务 ID（由 Bash 工具返回）' },
      block: {
        type: 'boolean',
        description: '是否等待任务完成再返回（默认 false）',
      },
    },
    required: ['task_id'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { task_id, block = false } = input
    const task = bashTaskRegistry.get(task_id)
    if (!task) {
      return { error: `任务 ${task_id} 不存在` }
    }

    if (block && task.status === 'running') {
      const start = Date.now()
      while (task.status === 'running' && Date.now() - start < 30000) {
        await new Promise((r) => setTimeout(r, 300))
      }
    }

    return {
      task_id: task.task_id,
      command: task.command,
      status: task.status,
      exitCode: task.exitCode,
      stdout: task.stdout.slice(0, 50000),
      stderr: task.stderr.slice(0, 10000),
      elapsedMs: Date.now() - task.startedAt,
    }
  },
}

/** Read — 读取文件内容 */
const readDef: ToolDefinition = {
  name: 'read',
  description: '读取指定路径的文件内容。支持按行号范围截取（适合大文件局部读取）。图片文件会以视觉形式呈现。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件绝对路径或相对路径' },
      offset: { type: 'integer', minimum: 1, description: '起始行号（从 1 开始）' },
      limit: { type: 'integer', minimum: 1, description: '最多读取的行数' },
    },
    required: ['file_path'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { file_path, offset, limit } = input
    const resolved = path.resolve(file_path)
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

/** Write — 写入/覆盖文件 */
const writeDef: ToolDefinition = {
  name: 'write',
  description: '将内容写入文件（覆盖）。若文件不存在则创建，若父目录不存在也会自动创建。写入前应先用 Read 读取现有内容以避免意外覆盖。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '文件绝对路径或相对路径' },
      content: { type: 'string', description: '要写入的完整文件内容' },
    },
    required: ['file_path', 'content'],
  },
  isConcurrencySafe: false, // 写操作，需要独占锁
  execute: async (input: any) => {
    const { file_path, content } = input
    const resolved = path.resolve(file_path)
    const dir = path.dirname(resolved)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(resolved, content, 'utf-8')
    const lines = content.split('\n').length
    return { success: true, file_path: resolved, linesWritten: lines }
  },
}

/** Edit — 精确字符串替换 */
const editDef: ToolDefinition = {
  name: 'edit',
  description: '对文件做精确的字符串替换。old_string 必须在文件中唯一存在（否则失败）。若需替换所有匹配项，设 replace_all: true。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要修改的文件路径' },
      old_string: { type: 'string', description: '要被替换的原始字符串（必须精确匹配）' },
      new_string: { type: 'string', description: '替换后的新字符串' },
      replace_all: {
        type: 'boolean',
        description: '是否替换文件中所有匹配项，默认 false（只替换一处，且要求唯一）',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  isConcurrencySafe: false, // 写操作，需要独占锁
  execute: async (input: any) => {
    const { file_path, old_string, new_string, replace_all = false } = input
    const resolved = path.resolve(file_path)
    if (!fs.existsSync(resolved)) {
      return { error: `文件不存在：${resolved}` }
    }

    const content = fs.readFileSync(resolved, 'utf-8')

    if (!replace_all) {
      const count = content.split(old_string).length - 1
      if (count === 0) {
        return { error: '未找到目标字符串，请检查 old_string 是否与文件内容精确匹配' }
      }
      if (count > 1) {
        return {
          error: `找到 ${count} 处匹配，old_string 不唯一。请提供更多上下文使其唯一，或设置 replace_all: true`,
        }
      }
    }

    const updated = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string)

    fs.writeFileSync(resolved, updated, 'utf-8')

    const replacedCount = replace_all ? content.split(old_string).length - 1 : 1
    return { success: true, file_path: resolved, replacedCount }
  },
}

/** MultiEdit — 批量字符串替换（单次调用） */
const multiEditDef: ToolDefinition = {
  name: 'multiEdit',
  description: '对同一文件进行多处字符串替换（原子操作，按顺序执行）。适合需要一次性修改多处的场景，比多次调用 Edit 更高效。',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '要修改的文件路径' },
      edits: {
        type: 'array',
        description: '替换操作列表，按顺序执行',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string', description: '要被替换的原始字符串' },
            new_string: { type: 'string', description: '替换后的新字符串' },
            replace_all: { type: 'boolean', description: '是否替换所有匹配项' },
          },
          required: ['old_string', 'new_string'],
        },
      },
    },
    required: ['file_path', 'edits'],
  },
  isConcurrencySafe: false, // 写操作，需要独占锁
  execute: async (input: any) => {
    const { file_path, edits } = input
    const resolved = path.resolve(file_path)
    if (!fs.existsSync(resolved)) {
      return { error: `文件不存在：${resolved}` }
    }

    let content = fs.readFileSync(resolved, 'utf-8')
    const results: Array<{ index: number; replacedCount: number; error?: string }> = []

    for (let i = 0; i < edits.length; i++) {
      const { old_string, new_string, replace_all = false } = edits[i]
      const count = content.split(old_string).length - 1

      if (count === 0) {
        results.push({ index: i, replacedCount: 0, error: '未找到目标字符串' })
        continue
      }
      if (!replace_all && count > 1) {
        results.push({ index: i, replacedCount: 0, error: `找到 ${count} 处匹配，需提供更多上下文或设置 replace_all: true` })
        continue
      }

      content = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string)

      results.push({ index: i, replacedCount: replace_all ? count : 1 })
    }

    const hasError = results.some((r) => r.error)
    if (!hasError) {
      fs.writeFileSync(resolved, content, 'utf-8')
    }

    return {
      success: !hasError,
      file_path: resolved,
      results,
      ...(hasError ? { error: '部分替换失败，文件未修改' } : {}),
    }
  },
}

/** Glob — 按文件名模式匹配文件 */
const globDef: ToolDefinition = {
  name: 'glob',
  description: '按 glob 模式匹配文件名（如 "**/*.ts"、"src/**/*.tsx"）。结果按修改时间排序。适合按名称查找文件，不查找文件内容（内容搜索用 Grep）。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob 模式，如 **/*.ts 或 src/**/*.tsx' },
      path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
    },
    required: ['pattern'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { pattern, path: searchPath } = input
    const root = path.resolve(searchPath ?? process.cwd())
    if (!fs.existsSync(root)) {
      return { error: `目录不存在：${root}` }
    }

    const re = globToRegExp(pattern)
    const allFiles = walkFiles(root)
    const matched = allFiles
      .map((f) => ({ rel: path.relative(root, f), abs: f }))
      .filter(({ rel }) => re.test(rel))
      .sort((a, b) => {
        const tA = fs.statSync(a.abs).mtimeMs
        const tB = fs.statSync(b.abs).mtimeMs
        return tB - tA
      })
      .map(({ rel }) => rel)

    return { pattern, root, count: matched.length, files: matched }
  },
}

/** Grep — 在文件内容中搜索正则模式 */
const grepDef: ToolDefinition = {
  name: 'grep',
  description: '在文件内容中搜索匹配正则模式的行。支持文件类型过滤、大小写忽略、上下文行显示。返回匹配行的文件路径、行号和内容。',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式，如 "function\\s+\\w+" 或 "import.*from"' },
      path: { type: 'string', description: '搜索根目录，默认为当前工作目录' },
      include: { type: 'string', description: '文件名过滤 glob，如 "*.ts" 或 "**/*.tsx"' },
      type: { type: 'string', description: '文件类型过滤，如 "js"、"py"、"ts"、"rust"' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: '输出模式：content（匹配行内容）/ files_with_matches（仅文件路径）/ count（匹配数量）',
      },
      ignore_case: { type: 'boolean', description: '是否忽略大小写，默认 false' },
      line_numbers: { type: 'boolean', description: '是否显示行号，默认 true' },
      context: { type: 'integer', minimum: 0, description: '匹配行前后各显示的上下文行数' },
      before_context: { type: 'integer', minimum: 0, description: '匹配行前显示的行数' },
      after_context: { type: 'integer', minimum: 0, description: '匹配行后显示的行数' },
      multiline: { type: 'boolean', description: '是否启用多行匹配（. 可匹配换行符）' },
      limit: { type: 'integer', minimum: 1, description: '最大返回结果数，默认 250' },
    },
    required: ['pattern'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const {
      pattern,
      path: searchPath,
      include,
      type: fileType,
      output_mode = 'content',
      ignore_case = false,
      context = 0,
      before_context,
      after_context,
      limit = 250,
    } = input
    const root = path.resolve(searchPath ?? process.cwd())
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
    const TYPE_EXT_MAP: Record<string, string[]> = {
      js: ['.js', '.mjs', '.cjs'],
      ts: ['.ts', '.tsx', '.mts', '.cts'],
      py: ['.py'],
      rust: ['.rs'],
      go: ['.go'],
      json: ['.json'],
      yaml: ['.yaml', '.yml'],
      md: ['.md', '.mdx'],
      css: ['.css', '.scss', '.sass', '.less'],
      html: ['.html', '.htm'],
    }

    let fileFilterRe: RegExp | null = null
    if (include) fileFilterRe = globToRegExp(include)

    const typeExts = fileType ? TYPE_EXT_MAP[fileType] : null

    const allFiles = walkFiles(root)
    const filteredFiles = allFiles.filter((f) => {
      const rel = path.relative(root, f)
      if (fileFilterRe && !fileFilterRe.test(path.basename(f)) && !fileFilterRe.test(rel)) return false
      if (typeExts && !typeExts.some((ext) => f.endsWith(ext))) return false
      return true
    })

    const bCtx = before_context ?? context
    const aCtx = after_context ?? context

    if (output_mode === 'files_with_matches') {
      const matchedFiles: string[] = []
      for (const file of filteredFiles) {
        let text: string
        try { text = fs.readFileSync(file, 'utf-8') } catch { continue }
        if (re.test(text)) {
          matchedFiles.push(path.relative(root, file))
          if (matchedFiles.length >= limit) break
        }
      }
      return { pattern, root, output_mode, count: matchedFiles.length, files: matchedFiles }
    }

    if (output_mode === 'count') {
      let total = 0
      for (const file of filteredFiles) {
        let text: string
        try { text = fs.readFileSync(file, 'utf-8') } catch { continue }
        const lines = text.split('\n')
        total += lines.filter((l: string) => re.test(l)).length
      }
      return { pattern, root, output_mode, total }
    }

    // content 模式
    const results: Array<{
      file: string
      line: number
      content: string
      context_before?: string[]
      context_after?: string[]
    }> = []

    outer: for (const file of filteredFiles) {
      let text: string
      try { text = fs.readFileSync(file, 'utf-8') } catch { continue }
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const entry: (typeof results)[0] = {
            file: path.relative(root, file),
            line: i + 1,
            content: lines[i].slice(0, 500),
          }
          if (bCtx > 0) {
            entry.context_before = lines.slice(Math.max(0, i - bCtx), i)
          }
          if (aCtx > 0) {
            entry.context_after = lines.slice(i + 1, Math.min(lines.length, i + 1 + aCtx))
          }
          results.push(entry)
          if (results.length >= limit) break outer
        }
      }
    }

    return {
      pattern,
      root,
      output_mode,
      total: results.length,
      truncated: results.length >= limit,
      results,
    }
  },
}

/** WebFetch — 抓取网页内容 */
const webFetchDef: ToolDefinition = {
  name: 'webFetch',
  description: '抓取指定 URL 的网页内容，并根据 prompt 提取关键信息。适合查阅文档、获取网页数据。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的网页 URL' },
      prompt: { type: 'string', description: '描述需要从页面中提取的信息' },
    },
    required: ['url', 'prompt'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { url, prompt: _prompt } = input
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(30000),
      })

      const contentType = res.headers.get('content-type') ?? ''
      const text = await res.text()

      const stripped = contentType.includes('text/html')
        ? text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
        : text

      return {
        url,
        status: res.status,
        contentType,
        content: stripped.slice(0, 100000),
        truncated: stripped.length > 100000,
      }
    } catch (err) {
      return { error: `抓取失败：${String(err)}`, url }
    }
  },
}

/** WebSearch — 网页搜索（调用 DuckDuckGo 搜索） */
const webSearchDef: ToolDefinition = {
  name: 'webSearch',
  description: '通过 DuckDuckGo 搜索互联网，返回搜索结果列表（标题、URL、摘要）。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词' },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '仅返回这些域名的结果',
      },
      blocked_domains: {
        type: 'array',
        items: { type: 'string' },
        description: '排除这些域名的结果',
      },
    },
    required: ['query'],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (input: any) => {
    const { query, allowed_domains, blocked_domains } = input
    try {
      const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' })
      const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
        headers: { 'User-Agent': 'Manta-Agent/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      const data = await res.json() as {
        AbstractText?: string
        AbstractURL?: string
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
      }

      const results: Array<{ title: string; url: string; snippet: string }> = []

      if (data.AbstractText && data.AbstractURL) {
        results.push({
          title: query,
          url: data.AbstractURL,
          snippet: data.AbstractText,
        })
      }

      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics) {
          if (topic.Text && topic.FirstURL) {
            const url = topic.FirstURL
            const hostname = new URL(url).hostname
            if (allowed_domains && !allowed_domains.some((d: string) => hostname.includes(d))) continue
            if (blocked_domains && blocked_domains.some((d: string) => hostname.includes(d))) continue
            results.push({ title: topic.Text.split(' - ')[0] ?? topic.Text, url, snippet: topic.Text })
          }
          if (results.length >= 10) break
        }
      }

      return { query, count: results.length, results }
    } catch (err) {
      return { error: `搜索失败：${String(err)}`, query }
    }
  },
}

/** TodoRead — 读取待办事项列表 */
const todoReadDef: ToolDefinition = {
  name: 'todoRead',
  description: '读取当前任务的待办事项列表，了解任务进度和待完成项目。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  isConcurrencySafe: true, // 只读操作，可以并发
  execute: async (_input: any) => {
    const todos = readTodos()
    return { todos, count: todos.length }
  },
}

/** TodoWrite — 写入待办事项列表 */
const todoWriteDef: ToolDefinition = {
  name: 'todoWrite',
  description: '更新待办事项列表（覆盖写入）。适合追踪复杂多步任务的进度。每次更新都要包含完整的 todos 列表。',
  parameters: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description: '完整的待办事项列表（覆盖写入）',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '唯一标识符' },
            content: { type: 'string', minLength: 1, description: '任务内容描述' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: '任务状态',
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description: '优先级',
            },
          },
          required: ['id', 'content', 'status', 'priority'],
        },
      },
    },
    required: ['todos'],
  },
  isConcurrencySafe: false, // 写操作，需要独占锁
  execute: async (input: any) => {
    const { todos } = input
    writeTodos(todos)
    const byStatus = {
      pending: todos.filter((t: any) => t.status === 'pending').length,
      in_progress: todos.filter((t: any) => t.status === 'in_progress').length,
      completed: todos.filter((t: any) => t.status === 'completed').length,
    }
    return { success: true, total: todos.length, byStatus }
  },
}

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

/** 将 glob 模式转为 RegExp */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00DOUBLESTAR\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\x00DOUBLESTAR\x00/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

/** 递归收集目录下所有文件 */
function walkFiles(dir: string, result: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, result)
    } else if (entry.isFile()) {
      result.push(full)
    }
  }
  return result
}

// ─── 导出所有 CC 工具定义，供 ToolRegistry 注册 ─────────────────────────────

export const ccToolDefs: ToolDefinition[] = [
  bashDef,
  bashOutputDef,
  readDef,
  writeDef,
  editDef,
  multiEditDef,
  globDef,
  grepDef,
  webFetchDef,
  webSearchDef,
  todoReadDef,
  todoWriteDef,
]
