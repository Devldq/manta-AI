import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initializeStorage, previewStorageParent } from './initializeStorage'

describe('storage initialization', () => {
  it('creates .manta-ai and all seven groups under an iCloud-like chosen parent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'iCloud Drive-'))
    const bootstrapPath = join(parent, 'control', 'ash-bootstrap.json')
    const result = await initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })
    expect(result.volume.parentPath).toBe(parent)
    for (const group of ['extensions','knowledge','work','config','secrets','diagnostics','cache']) await expect(stat(join(parent, '.manta-ai', group))).resolves.toBeTruthy()
    expect(JSON.parse(await readFile(bootstrapPath, 'utf8')).volumes[0].parentPath).toBe(parent)
  })

  it('rejects relative paths, existing ordinary roots, and insufficient space', async () => {
    await expect(previewStorageParent('relative/path')).resolves.toMatchObject({ ok: false })
    const parent = await mkdtemp(join(tmpdir(), 'ash-parent-'))
    await expect(initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'b.json'), minimumFreeBytes: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' })
  })

  it('recovers a complete renamed volume when bootstrap commit was interrupted', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-recover-')); const firstBootstrap = join(parent, 'first.json')
    const first = await initializeStorage({ parentPath: parent, bootstrapPath: firstBootstrap, minimumFreeBytes: 1 })
    const recovered = await initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'recovered.json'), minimumFreeBytes: 1 })
    expect(recovered.volume.id).toBe(first.volume.id)
  })
})
