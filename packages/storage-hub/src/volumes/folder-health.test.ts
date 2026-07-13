import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FolderHealthPoller, inspectFolderHealth } from './folder-health'

describe('inspectFolderHealth', () => {
  it('uses a metadata-only default walker so health checks never read or hash cloud files', async () => {
    const source = await readFile(new URL('./folder-health.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('inventoryTree')
    expect(source).not.toContain('createReadStream')
    expect(source).not.toContain('readFile(')
  })

  it('reports an unavailable volume root as offline', async () => {
    const health = await inspectFolderHealth(join(tmpdir(), `ash-missing-${Date.now()}`))
    expect(health).toMatchObject({ status: 'offline', reason: 'root-unavailable' })
  })

  it('reports cloud conflict-copy names without changing the inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-folder-health-'))
    await mkdir(join(root, 'skills'))
    await writeFile(join(root, 'skills', 'notes (Alice\'s conflicted copy 2026-07-13).md'), 'keep both')

    const health = await inspectFolderHealth(root)

    expect(health.status).toBe('conflict')
    expect(health.conflicts).toEqual(['skills/notes (Alice\'s conflicted copy 2026-07-13).md'])
  })

  it('reports an unreadable cloud placeholder and never treats it as an empty inventory', async () => {
    const health = await inspectFolderHealth('C:\\icloud', {
      inventory: async () => { const error = Object.assign(new Error('not downloaded'), { code: 'EACCES' }); throw error },
    })
    expect(health).toMatchObject({ status: 'unreadable', reason: 'inventory-unreadable', conflicts: [] })
  })

  it('polls inventory without fs.watch and stops after disposal', async () => {
    vi.useFakeTimers()
    const inventory = vi.fn(async () => ({ entries: [] }))
    const onHealth = vi.fn()
    const poller = new FolderHealthPoller({ volumes: () => [{ volumeId: 'work', root: 'C:\\icloud' }], pollIntervalMs: 1_000, inventory, onHealth })

    await poller.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(inventory).toHaveBeenCalledTimes(2)
    expect(onHealth).toHaveBeenLastCalledWith('work', expect.objectContaining({ status: 'healthy' }))

    poller.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(inventory).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('accepts a platform health inspector so Desktop can detect cloud placeholders without synthesizing an inventory', async () => {
    const inspect = vi.fn(async (root: string) => ({ root, status: 'unreadable' as const, conflicts: [], checkedAt: '2026-07-13T00:00:00.000Z', reason: 'inventory-unreadable' as const }))
    const onHealth = vi.fn()
    const poller = new FolderHealthPoller({ volumes: () => [{ volumeId: 'cloud', root: 'C:\\icloud' }], pollIntervalMs: 60_000, inspect, onHealth })
    await poller.poll()
    expect(inspect).toHaveBeenCalledWith('C:\\icloud')
    expect(onHealth).toHaveBeenCalledWith('cloud', expect.objectContaining({ status: 'unreadable' }))
    poller.dispose()
  })
})
