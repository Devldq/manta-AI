import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { WorkspaceTerminalService, type WorkspaceTerminalEvent } from '../core/services/workspace-terminal.service'
import { resolveWorkspaceRoot } from './fs'

const execFileAsync = promisify(execFile)
const MAX_DIFF_BYTES = 500_000

interface ReviewFile {
  path: string
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

      const [statusOutput, unstagedDiff, stagedDiff] = await Promise.all([
        runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
        runGit(root, ['diff', '--no-ext-diff', '--unified=2', '--', '.']).catch(() => ''),
        runGit(root, ['diff', '--cached', '--no-ext-diff', '--unified=2', '--', '.']).catch(() => ''),
      ])
      const files = parseGitStatus(statusOutput)
      const fullDiff = [stagedDiff && '# 已暂存变更\n', stagedDiff, unstagedDiff && '# 未暂存变更\n', unstagedDiff]
        .filter(Boolean)
        .join('')
      const diff = fullDiff.slice(0, MAX_DIFF_BYTES)
      return reply.send({
        repository: true,
        root,
        clean: files.length === 0,
        files,
        counts: summarizeFiles(files),
        diff,
        truncated: diff.length < fullDiff.length,
      })
    } catch (error) {
      return sendWorkspaceError(reply, error, '无法读取工作区变更')
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

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_DIFF_BYTES * 4,
    timeout: 10_000,
  })
  return stdout
}

function parseGitStatus(output: string): ReviewFile[] {
  const records = output.split('\0').filter(Boolean)
  const files: ReviewFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const indexStatus = record[0] || ' '
    const worktreeStatus = record[1] || ' '
    let path = record.slice(3)
    if ((indexStatus === 'R' || indexStatus === 'C') && records[index + 1]) {
      path = `${records[index + 1]} → ${path}`
      index += 1
    }
    files.push({
      path,
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
