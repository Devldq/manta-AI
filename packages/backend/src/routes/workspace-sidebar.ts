import { execFile } from 'node:child_process'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { WorkspaceTerminalService, type WorkspaceTerminalEvent } from '../core/services/workspace-terminal.service'
import { resolveWorkspaceRoot } from './fs'

const execFileAsync = promisify(execFile)
const MAX_DIFF_BYTES = 500_000

interface ReviewFile {
  path: string
  previousPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
}

export async function workspaceSidebarRoutes(app: FastifyInstance) {
  const terminals = new WorkspaceTerminalService()
  app.addHook('onClose', async () => terminals.closeAll())

  app.get('/api/workspace-sidebar/review', async (request, reply) => {
    const query = request.query as { workspaceId?: string }
    if (!query.workspaceId) return reply.status(400).send({ error: '缺少 workspaceId 参数' })
    try {
      const root = await resolveWorkspaceRoot(query.workspaceId)
      const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
      if (inside.trim() !== 'true') {
        return reply.send({ repository: false, root, files: [], diff: '', truncated: false })
      }

      const review = await readReview(root)
      const { files } = review
      const [unstagedDiff, stagedDiff] = await Promise.all([
        runGit(root, ['diff', '--no-ext-diff', '--unified=2', '--', '.']).catch(() => ''),
        runGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=2', '--', '.']).catch(() => ''),
      ])
      const fullDiff = [stagedDiff && '# 已暂存变更\n', stagedDiff, unstagedDiff && '# 未暂存变更\n', unstagedDiff]
        .filter(Boolean)
        .join('')
      const diff = fullDiff.slice(0, MAX_DIFF_BYTES)
      return reply.send({
        repository: true,
        root,
        clean: files.length === 0,
        ...review,
        diff,
        truncated: diff.length < fullDiff.length,
      })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法读取工作区变更')
    }
  })

  app.get('/api/workspace-sidebar/review/file', async (request, reply) => {
    const query = request.query as { workspaceId?: string; path?: string }
    if (!query.workspaceId || !query.path) {
      return reply.status(400).send({ error: '缺少 workspaceId 或 path 参数' })
    }
    try {
      const root = await resolveWorkspaceRoot(query.workspaceId)
      const files = parseGitStatus(await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']))
      const file = files.find((entry) => entry.path === query.path)
      if (!file) return reply.status(404).send({ error: '该文件不在当前变更列表中' })
      return reply.send(await readFileDiff(root, file))
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法读取文件差异')
    }
  })

  app.post('/api/workspace-sidebar/review/commit', async (request, reply) => {
    const body = request.body as {
      workspaceId?: string
      message?: string
      includeUnstaged?: boolean
      push?: boolean
    }
    const message = body.message?.trim() || ''
    if (!body.workspaceId) return reply.status(400).send({ error: '缺少 workspaceId 参数' })
    if (!message) return reply.status(400).send({ error: '请输入提交信息' })
    if (message.length > 500) return reply.status(400).send({ error: '提交信息不能超过 500 个字符' })
    try {
      const root = await resolveWorkspaceRoot(body.workspaceId)
      if (body.includeUnstaged) await runGit(root, ['add', '--all', '--', '.'])
      const stagedFiles = await runGit(root, ['diff', '--cached', '--name-only', '--', '.'])
      if (!stagedFiles.trim()) return reply.status(409).send({ error: '没有已暂存的变更可提交' })
      const commitOutput = await runGit(root, ['commit', '-m', message], { timeout: 60_000 })
      const pushOutput = body.push ? await pushCurrentBranch(root) : ''
      return reply.send({
        success: true,
        committed: true,
        pushed: Boolean(body.push),
        output: [commitOutput, pushOutput].filter(Boolean).join('\n'),
        review: await readReview(root),
      })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法提交工作区变更')
    }
  })

  app.post('/api/workspace-sidebar/review/push', async (request, reply) => {
    const body = request.body as { workspaceId?: string }
    if (!body.workspaceId) return reply.status(400).send({ error: '缺少 workspaceId 参数' })
    try {
      const root = await resolveWorkspaceRoot(body.workspaceId)
      const output = await pushCurrentBranch(root)
      return reply.send({ success: true, pushed: true, output, review: await readReview(root) })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法推送当前分支')
    }
  })

  app.get('/api/workspace-sidebar/terminal/sessions', async (request, reply) => {
    const query = request.query as { workspaceId?: string; conversationId?: string }
    if (!query.workspaceId || !query.conversationId) {
      return reply.status(400).send({ error: '缺少 workspaceId 或 conversationId 参数' })
    }
    try {
      const sessions = terminals.list(query.workspaceId, query.conversationId)
      return reply.send({ sessions, provider: 'system-shell' })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法读取终端会话')
    }
  })

  app.post('/api/workspace-sidebar/terminal/sessions', async (request, reply) => {
    const body = request.body as { workspaceId?: string; conversationId?: string }
    if (!body.workspaceId || !body.conversationId) {
      return reply.status(400).send({ error: '缺少 workspaceId 或 conversationId 参数' })
    }
    try {
      const cwd = await resolveWorkspaceRoot(body.workspaceId)
      const session = terminals.create({
        workspaceId: body.workspaceId,
        conversationId: body.conversationId,
        cwd,
      })
      return reply.status(201).send({ session })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法启动终端会话')
    }
  })

  app.get('/api/workspace-sidebar/terminal/sessions/:id/socket', { websocket: true }, (socket, request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { afterSeq?: string }
    const session = terminals.get(id)
    if (!session) {
      socket.close(1008, '终端会话不存在')
      return
    }
    const requestedAfterSeq = Number.parseInt(query.afterSeq || '0', 10)
    let lastSeq = Number.isFinite(requestedAfterSeq) ? Math.max(0, requestedAfterSeq) : 0
    const sendEvent = (event: WorkspaceTerminalEvent) => {
      if (event.seq <= lastSeq || socket.readyState !== socket.OPEN) return
      lastSeq = event.seq
      socket.send(JSON.stringify({ type: event.type, seq: event.seq, data: event.data }))
    }
    const unsubscribe = terminals.subscribe(id, sendEvent)
    for (const event of terminals.events(id, lastSeq)) sendEvent(event)
    socket.send(JSON.stringify({ type: 'ready', session }))

    socket.on('message', (raw: { byteLength: number; toString(): string }) => {
      if (raw.byteLength > 64 * 1024) {
        socket.close(1009, '终端消息过大')
        return
      }
      try {
        const message = JSON.parse(raw.toString()) as {
          type?: string
          data?: string
          cols?: number
          rows?: number
        }
        if (message.type === 'input' && typeof message.data === 'string') {
          terminals.write(id, message.data)
        } else if (
          message.type === 'resize'
          && Number.isFinite(message.cols)
          && Number.isFinite(message.rows)
        ) {
          terminals.resize(id, Number(message.cols), Number(message.rows))
        }
      } catch (error) {
        app.log.debug({ error, terminalSessionId: id }, 'Ignored invalid terminal WebSocket message')
      }
    })
    socket.once('close', unsubscribe)
    socket.once('error', unsubscribe)
  })

  app.delete('/api/workspace-sidebar/terminal/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      terminals.close(id)
      return reply.status(204).send()
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法关闭终端会话')
    }
  })
}

async function readReview(root: string) {
  const [statusOutput, branchName, shortHead, upstream, remoteUrl, numstat] = await Promise.all([
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    runGit(root, ['branch', '--show-current']).catch(() => ''),
    runGit(root, ['rev-parse', '--short', 'HEAD']).catch(() => ''),
    runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
    runGit(root, ['remote', 'get-url', 'origin']).catch(() => ''),
    runGit(root, ['diff', '--numstat', 'HEAD', '--', '.']).catch(() => ''),
  ])
  const files = parseGitStatus(statusOutput)
  const [behind, ahead] = upstream.trim()
    ? parseAheadBehind(await runGit(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).catch(() => ''))
    : [0, 0]
  const trackedStats = parseNumstat(numstat)
  const untrackedAdditions = await countUntrackedAdditions(root, files)
  const branch = branchName.trim()

  return {
    files,
    counts: summarizeFiles(files),
    branch: {
      name: branch || (shortHead.trim() ? `HEAD@${shortHead.trim()}` : 'HEAD'),
      detached: !branch,
      upstream: upstream.trim() || undefined,
      ahead,
      behind,
      hasRemote: Boolean(remoteUrl.trim()),
    },
    stats: {
      additions: trackedStats.additions + untrackedAdditions,
      deletions: trackedStats.deletions,
    },
  }
}

async function readFileDiff(root: string, file: ReviewFile) {
  const originalPath = file.previousPath || file.path
  const [original, modified, unified] = await Promise.all([
    file.kind === 'added' || file.kind === 'untracked'
      ? Promise.resolve('')
      : runGit(root, ['show', `HEAD:${originalPath}`]).catch(() => ''),
    file.kind === 'deleted'
      ? Promise.resolve('')
      : readWorkspaceTextFile(root, file.path),
    file.kind === 'untracked'
      ? runGitAllowChanges(root, ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', file.path])
      : runGit(root, ['diff', 'HEAD', '--no-ext-diff', '--unified=3', '--', file.path]).catch(async () => {
          const [staged, unstaged] = await Promise.all([
            runGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=3', '--', file.path]).catch(() => ''),
            runGit(root, ['diff', '--no-ext-diff', '--unified=3', '--', file.path]).catch(() => ''),
          ])
          return [staged, unstaged].filter(Boolean).join('\n')
        }),
  ])
  const binary = original.includes('\0') || modified.includes('\0') || /Binary files .* differ/.test(unified)
  return {
    path: file.path,
    previousPath: file.previousPath,
    unified: unified.slice(0, MAX_DIFF_BYTES),
    original: original.slice(0, MAX_DIFF_BYTES),
    modified: modified.slice(0, MAX_DIFF_BYTES),
    binary,
    truncated: unified.length > MAX_DIFF_BYTES || original.length > MAX_DIFF_BYTES || modified.length > MAX_DIFF_BYTES,
  }
}

async function readWorkspaceTextFile(root: string, path: string): Promise<string> {
  const rootPath = resolve(root)
  const filePath = resolve(root, path)
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) {
    throw Object.assign(new Error('文件路径超出工作区范围'), { statusCode: 400 })
  }
  const fileInfo = await lstat(filePath).catch(() => undefined)
  if (!fileInfo) return ''
  if (fileInfo.isSymbolicLink()) return readlink(filePath).catch(() => '')
  if (!fileInfo.isFile()) return ''
  return readFile(filePath, 'utf8').catch(() => '')
}

async function countUntrackedAdditions(root: string, files: ReviewFile[]): Promise<number> {
  const counts = await Promise.all(files
    .filter((file) => file.kind === 'untracked')
    .map(async (file) => {
      const content = await readWorkspaceTextFile(root, file.path)
      if (!content || content.includes('\0')) return 0
      return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
    }))
  return counts.reduce((sum, count) => sum + count, 0)
}

function parseAheadBehind(output: string): [number, number] {
  const [behind = '0', ahead = '0'] = output.trim().split(/\s+/)
  return [Number.parseInt(behind, 10) || 0, Number.parseInt(ahead, 10) || 0]
}

function parseNumstat(output: string) {
  return output.split('\n').reduce((stats, line) => {
    const [added, deleted] = line.split('\t')
    if (/^\d+$/.test(added)) stats.additions += Number.parseInt(added, 10)
    if (/^\d+$/.test(deleted)) stats.deletions += Number.parseInt(deleted, 10)
    return stats
  }, { additions: 0, deletions: 0 })
}

async function pushCurrentBranch(root: string): Promise<string> {
  const branch = (await runGit(root, ['branch', '--show-current'])).trim()
  if (!branch) throw Object.assign(new Error('游离 HEAD 状态下无法自动推送'), { statusCode: 409 })
  const upstream = (await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => '')).trim()
  if (upstream) return runGit(root, ['push'], { timeout: 60_000, nonInteractive: true })
  const origin = (await runGit(root, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
  if (!origin) throw Object.assign(new Error('当前仓库没有 origin 远程仓库'), { statusCode: 409 })
  return runGit(root, ['push', '--set-upstream', 'origin', branch], { timeout: 60_000, nonInteractive: true })
}

async function runGit(
  cwd: string,
  args: string[],
  options: { timeout?: number; nonInteractive?: boolean } = {},
): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_DIFF_BYTES * 4,
    timeout: options.timeout ?? 10_000,
    env: options.nonInteractive
      ? { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
      : process.env,
  })
  return stdout
}

async function runGitAllowChanges(cwd: string, args: string[]): Promise<string> {
  try {
    return await runGit(cwd, args)
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && Number(error.code) === 1 && 'stdout' in error) {
      return String(error.stdout || '')
    }
    throw error
  }
}

function parseGitStatus(output: string): ReviewFile[] {
  const records = output.split('\0').filter(Boolean)
  const files: ReviewFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const indexStatus = record[0] || ' '
    const worktreeStatus = record[1] || ' '
    const path = record.slice(3)
    let previousPath: string | undefined
    if ((indexStatus === 'R' || indexStatus === 'C') && records[index + 1]) {
      previousPath = records[index + 1]
      index += 1
    }
    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      indexStatus,
      worktreeStatus,
      kind: statusKind(indexStatus, worktreeStatus),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' }))
}

function statusKind(indexStatus: string, worktreeStatus: string): ReviewFile['kind'] {
  const pair = `${indexStatus}${worktreeStatus}`
  if (pair === '??') return 'untracked'
  if (pair.includes('U') || pair === 'AA' || pair === 'DD') return 'conflicted'
  if (pair.includes('R') || pair.includes('C')) return 'renamed'
  if (pair.includes('D')) return 'deleted'
  if (pair.includes('A')) return 'added'
  return 'modified'
}

function summarizeFiles(files: ReviewFile[]) {
  return files.reduce<Record<ReviewFile['kind'], number>>(
    (counts, file) => ({ ...counts, [file.kind]: counts[file.kind] + 1 }),
    { added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
  )
}

function sendWorkspaceError(reply: FastifyReply, error: unknown, fallback: string) {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode: number }).statusCode)
    : 500
  return reply.status(statusCode).send({ error: error instanceof Error ? error.message : fallback })
}
