import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { GitSyncService } from './git-sync-service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('blocks a volume when an unexpected Git import staging worktree exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ash-git-pending-')); roots.push(root)
  await mkdir(join(root, '.ash', 'sync', 'import-staging', 'orphan'), { recursive: true })
  const service = new GitSyncService({ runner: {} as never, bindings: {} as never, volumes: { resolveVolumeRoot: () => root }, cachePath: () => root })
  await expect(service.inspectPending('v1')).resolves.toMatchObject({ pending: true, blockers: [expect.objectContaining({ code: 'git-import-pending' })] })
})
