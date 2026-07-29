import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { execFileSync } from 'node:child_process'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorkspace } from '../core/storage/workspace/store'
import { runWithStorageResolver } from '../storage/path-routing'
import { workspaceSidebarRoutes } from './workspace-sidebar'

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'manta-workspace-sidebar-'))
  const project = join(root, 'project')
  const remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', remote])
  execFileSync('git', ['init', '-b', 'main', project])
  execFileSync('git', ['-C', project, 'config', 'user.email', 'manta@example.test'])
  execFileSync('git', ['-C', project, 'config', 'user.name', 'Manta Test'])
  await writeFile(join(project, 'tracked.txt'), 'before\n')
  execFileSync('git', ['-C', project, 'add', 'tracked.txt'])
  execFileSync('git', ['-C', project, 'commit', '-m', 'fixture'])
  execFileSync('git', ['-C', project, 'remote', 'add', 'origin', remote])
  execFileSync('git', ['-C', project, 'push', '--set-upstream', 'origin', 'main'])
  await writeFile(join(project, 'tracked.txt'), 'after\n')
  await writeFile(join(project, 'new.txt'), 'new\n')

  const resolveStorage = (group: string, ...segments: string[]) => join(root, 'storage', group, ...segments)
  const workspace = runWithStorageResolver(
    { resolve: resolveStorage },
    () => createWorkspace({ name: 'sidebar-test', folderPath: project }),
  )
  const app = Fastify()
  app.addHook('onRequest', (_request, _reply, done) => {
    runWithStorageResolver({ resolve: resolveStorage }, done)
  })
  await app.register(websocket)
  await app.register(workspaceSidebarRoutes)
  return { app, workspace, project, remote }
}

describe('workspace sidebar routes', () => {
  it('returns real Git changes scoped to the selected workspace', async () => {
    const { app, workspace } = await createFixture()
    try {
      const response = await app.inject(`/api/workspace-sidebar/review?workspaceId=${workspace.id}`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        repository: true,
        clean: false,
        counts: { modified: 1, untracked: 1 },
        branch: { name: 'main', upstream: 'origin/main', ahead: 0, behind: 0, hasRemote: true },
        stats: { additions: 2, deletions: 1 },
      })
      expect(response.json().files.map((file: { path: string }) => file.path)).toEqual(['new.txt', 'tracked.txt'])
      expect(response.json().diff).toContain('-before')
      expect(response.json().diff).toContain('+after')
    } finally {
      await app.close()
    }
  })

  it('returns unified and split-ready content for a selected changed file', async () => {
    const { app, workspace, project } = await createFixture()
    try {
      const tracked = await app.inject(
        `/api/workspace-sidebar/review/file?workspaceId=${workspace.id}&path=tracked.txt`,
      )
      expect(tracked.statusCode).toBe(200)
      expect(tracked.json()).toMatchObject({
        path: 'tracked.txt',
        original: 'before\n',
        modified: 'after\n',
        binary: false,
      })
      expect(tracked.json().unified).toContain('-before')
      expect(tracked.json().unified).toContain('+after')

      const untracked = await app.inject(
        `/api/workspace-sidebar/review/file?workspaceId=${workspace.id}&path=new.txt`,
      )
      expect(untracked.statusCode).toBe(200)
      expect(untracked.json()).toMatchObject({ original: '', modified: 'new\n', binary: false })
      expect(untracked.json().unified).toContain('+new')

      await writeFile(join(project, '..', 'secret.txt'), 'must-not-leak\n')
      await symlink('../secret.txt', join(project, 'secret-link'))
      const link = await app.inject(
        `/api/workspace-sidebar/review/file?workspaceId=${workspace.id}&path=secret-link`,
      )
      expect(link.statusCode).toBe(200)
      expect(link.json().modified).toBe('../secret.txt')
      expect(link.json().modified).not.toContain('must-not-leak')
    } finally {
      await app.close()
    }
  })

  it('commits selected workspace changes and pushes the current branch', async () => {
    const { app, workspace, project, remote } = await createFixture()
    try {
      const committed = await app.inject({
        method: 'POST',
        url: '/api/workspace-sidebar/review/commit',
        payload: {
          workspaceId: workspace.id,
          message: 'review changes',
          includeUnstaged: true,
          push: false,
        },
      })
      expect(committed.statusCode).toBe(200)
      expect(committed.json()).toMatchObject({
        success: true,
        committed: true,
        pushed: false,
        review: { files: [], branch: { ahead: 1 } },
      })

      const pushed = await app.inject({
        method: 'POST',
        url: '/api/workspace-sidebar/review/push',
        payload: { workspaceId: workspace.id },
      })
      expect(pushed.statusCode).toBe(200)
      expect(pushed.json()).toMatchObject({
        success: true,
        pushed: true,
        review: { branch: { ahead: 0 } },
      })
      expect(execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim())
        .toBe(execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
    } finally {
      await app.close()
    }
  })

  it('requires an explicit workspace before starting a terminal', async () => {
    const { app } = await createFixture()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/workspace-sidebar/terminal/sessions',
        payload: { conversationId: 'conversation-a' },
      })
      expect(response.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it('uses the built-in system shell provider without an external terminal dependency', async () => {
    const { app } = await createFixture()
    try {
      const response = await app.inject(
        '/api/workspace-sidebar/terminal/sessions?workspaceId=workspace-a&conversationId=conversation-a',
      )
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        provider: 'system-shell',
        sessions: [],
      })
    } finally {
      await app.close()
    }
  })

  it('streams raw interactive PTY input and output over WebSocket', async () => {
    const { app, workspace } = await createFixture()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/workspace-sidebar/terminal/sessions',
        payload: { workspaceId: workspace.id, conversationId: 'conversation-pty' },
      })
      expect(created.statusCode).toBe(201)
      const sessionId = created.json().session.id as string
      const messages: Array<{ type: string; data?: string }> = []
      const socket = await app.injectWS(
        `/api/workspace-sidebar/terminal/sessions/${sessionId}/socket`,
        undefined,
        {
          onInit: (client) => client.on(
            'message',
            (raw: { toString(): string }) => messages.push(JSON.parse(raw.toString())),
          ),
        },
      )
      socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
      socket.send(JSON.stringify({ type: 'input', data: "printf '__MANTA_PTY_SOCKET_OK__\\n'\r" }))

      await waitFor(() => messages.some((message) => message.data?.includes('__MANTA_PTY_SOCKET_OK__')))
      expect(messages.some((message) => message.type === 'ready')).toBe(true)
      socket.close()
    } finally {
      await app.close()
    }
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal WebSocket output')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
