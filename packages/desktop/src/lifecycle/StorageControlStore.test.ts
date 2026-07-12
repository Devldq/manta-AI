import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StorageControlStore, type RelaunchIntent } from './StorageControlStore'

describe('StorageControlStore', () => {
  it('durably keeps running, succeeded, and failed operations after a new instance opens the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-control-')); const first = new StorageControlStore(root)
    await first.startOperation('op-running', 'volume'); await first.recordProgress({ operationId:'op-running', phase:'copying', filesCompleted:1,filesTotal:2,bytesCompleted:4,bytesTotal:8,message:'copying' })
    await first.startOperation('op-ok', 'group'); await first.completeOperation('op-ok', [{ kind:'group', operationId:'op-ok', groupId:'work', sourcePath:'A', targetPath:'B', backupPath:'A/.ash-backups/op-ok/work' }])
    await first.startOperation('op-fail', 'volume'); await first.failOperation('op-fail', new Error('disk lost'))
    const reopened = new StorageControlStore(root)
    expect((await reopened.getOperation('op-running'))?.status).toBe('running')
    expect((await reopened.getOperation('op-ok'))?.backupRefs[0].backupPath).toContain('op-ok')
    expect((await reopened.getOperation('op-fail'))?.error).toBe('disk lost')
  })

  it('persists and clears a new-process health intent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-intent-')); const store = new StorageControlStore(root)
    const intent = { schemaVersion:1, operationId:'op', phase:'awaiting-new-process-health', attempt:0, previous:{ generation:1 }, current:{ generation:2 }, backupRefs:[] } as unknown as RelaunchIntent
    await store.writeIntent(intent); expect((await new StorageControlStore(root).readIntent())?.operationId).toBe('op')
    await store.clearIntent(); expect(await store.readIntent()).toBeUndefined()
  })
})
