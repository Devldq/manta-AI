import Fastify from 'fastify'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorkspace } from '../core/storage/workspace/store'
import { runWithStorageResolver } from '../storage/path-routing'
import { workspaceSidebarRoutes } from './workspace-sidebar'

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'manta-workspace-sidebar-'))
  const project = join(root, 'project')
  execFileSync('git', ['init', project])
  execFileSync('git', ['-C', project, 'config', 'user.email', 'manta@example.test'])
  execFileSync('git', ['-C', project, 'config', 'user.name', 'Manta Test'])
  await writeFile(join(project, 'tracked.txt'), 'before\n')
  execFileSync('git', ['-C', project, 'add', 'tracked.txt'])
  execFileSync('git', ['-C', project, 'commit', '-m', 'fixture'])
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
  await app.register(workspaceSidebarRoutes)
  return { app, workspace }
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
      })
      expect(response.json().files.map((file: { path: string }) => file.path)).toEqual(['new.txt', 'tracked.txt'])
      expect(response.json().diff).toContain('-before')
      expect(response.json().diff).toContain('+after')
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
})
