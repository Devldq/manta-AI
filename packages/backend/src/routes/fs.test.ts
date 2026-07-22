import Fastify from 'fastify'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWorkspace } from '../core/storage/workspace/store'
import { runWithStorageResolver } from '../storage/path-routing'
import { fsRoutes } from './fs'

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'manta-file-preview-'))
  const project = join(root, 'project')
  const outside = join(root, 'outside.txt')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Manta\n')
  await writeFile(outside, 'secret')

  const resolveStorage = (group: string, ...segments: string[]) => join(root, 'storage', group, ...segments)
  const workspace = runWithStorageResolver(
    { resolve: resolveStorage },
    () => createWorkspace({ name: 'preview-test', folderPath: project }),
  )
  const app = Fastify()
  app.addHook('onRequest', (_request, _reply, done) => {
    runWithStorageResolver({ resolve: resolveStorage }, done)
  })
  await app.register(fsRoutes)
  return { app, outside, project, workspace }
}

describe('workspace file preview', () => {
  it('returns a text file inside the selected workspace', async () => {
    const { app, workspace } = await createFixture()
    try {
      const response = await app.inject(`/api/fs/preview?workspaceId=${workspace.id}&path=README.md`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ kind: 'text', path: 'README.md', content: '# Manta\n' })
    } finally {
      await app.close()
    }
  })

  it('rejects absolute paths and symlinks that escape the workspace', async () => {
    const { app, outside, project, workspace } = await createFixture()
    await symlink(outside, join(project, 'outside-link.txt'))
    try {
      for (const filePath of [outside, 'outside-link.txt']) {
        const query = new URLSearchParams({ workspaceId: workspace.id, path: filePath })
        const response = await app.inject(`/api/fs/preview?${query}`)
        expect(response.statusCode).toBe(403)
        expect(response.json().error).toContain('当前工作区')
      }
    } finally {
      await app.close()
    }
  })
})
