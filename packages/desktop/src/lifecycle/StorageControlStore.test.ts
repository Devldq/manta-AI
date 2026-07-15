import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StorageControlStore, type RelaunchIntent } from './StorageControlStore'

describe('StorageControlStore', () => {
  it('durably keeps running, succeeded, and failed operations after a new instance opens the catalog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-control-')); const first = new StorageControlStore(root)
    await first.startOperation('op-running', 'volume'); await first.recordProgress({ operationId:'op-running', phase:'copying', filesCompleted:1,filesTotal:2,bytesCompleted:4,bytesTotal:8,message:'copying' })
    await first.startOperation('op-ok', 'group'); await first.completeOperation('op-ok', [{ kind:'group', operationId:'op-ok', groupId:'work', sourcePath:'C:/A', targetPath:'C:/B', backupPath:'C:/A/.manta-ai/.ash-backups/op-ok/work' }])
    await first.startOperation('op-fail', 'volume'); await first.failOperation('op-fail', new Error('disk lost'))
    const reopened = new StorageControlStore(root)
    expect((await reopened.getOperation('op-running'))?.status).toBe('running')
    expect((await reopened.getOperation('op-ok'))?.backupRefs[0].backupPath).toContain('op-ok')
    expect((await reopened.getOperation('op-fail'))?.error).toBe('disk lost')
  })

  it('persists and clears a new-process health intent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-intent-')); const store = new StorageControlStore(root)
    const timestamp='2026-01-01T00:00:00.000Z'; const snapshot=(generation:number)=>({schemaVersion:1 as const,generation,volumes:[{id:'volume',name:'Volume',parentPath:'C:/control',createdAt:timestamp,updatedAt:timestamp}],groupAssignments:{extensions:'volume',knowledge:'volume',work:'volume',config:'volume',secrets:'volume',diagnostics:'volume',cache:'volume'}})
    const intent = { schemaVersion:1, operationId:'op', phase:'awaiting-new-process-health', attempt:0, previous:snapshot(1), current:snapshot(2), backupRefs:[] } as RelaunchIntent
    await store.writeIntent(intent); expect((await new StorageControlStore(root).readIntent())?.operationId).toBe('op')
    await store.clearIntent(); expect(await store.readIntent()).toBeUndefined()
  })

  it('atomically records a committed operation and relaunch intent before marking it relaunching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-intent-')); const store = new StorageControlStore(root)
    const timestamp='2026-01-01T00:00:00.000Z'; const snapshot=(generation:number)=>({schemaVersion:1 as const,generation,volumes:[{id:'volume',name:'Volume',parentPath:'C:/control',createdAt:timestamp,updatedAt:timestamp}],groupAssignments:{extensions:'volume',knowledge:'volume',work:'volume',config:'volume',secrets:'volume',diagnostics:'volume',cache:'volume'}})
    await store.startOperation('op-atomic', 'volume')
    await store.completeOperation('op-atomic', [], { previous: snapshot(1), current: snapshot(2) })
    expect((await store.getOperation('op-atomic'))?.status).toBe('running')
    expect((await store.getOperation('op-atomic'))?.phase).toBe('committed')
    await store.commitRelaunchIntent({ schemaVersion:1, operationId:'op-atomic', phase:'awaiting-new-process-health', attempt:0, previous:snapshot(1), current:snapshot(2), backupRefs:[] })
    const reopened = new StorageControlStore(root)
    expect((await reopened.getOperation('op-atomic'))?.phase).toBe('relaunching')
    expect((await reopened.readIntent())?.operationId).toBe('op-atomic')
  })

  it('serializes concurrent instances so their operation updates are not lost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-control-concurrent-'))
    const stores = Array.from({ length: 16 }, () => new StorageControlStore(root))
    await Promise.all(stores.map((store, index) => store.startOperation(`op-${index}`, index % 2 ? 'group' : 'volume')))
    expect((await new StorageControlStore(root).listOperations()).map((item) => item.id).sort()).toEqual(stores.map((_, index) => `op-${index}`).sort())
  })

  it('rejects tampered catalog and intent records instead of treating paths as trusted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ash-control-tampered-')); const store = new StorageControlStore(root)
    await writeFile(store.catalogPath, JSON.stringify({ schemaVersion: 1, operations: [{ id: 'bad', backupRefs: [{ backupPath: 'C:/arbitrary' }] }] }))
    await expect(store.listOperations()).rejects.toThrow(/Invalid storage operation catalog/)
    await writeFile(store.intentPath, JSON.stringify({ schemaVersion: 1, operationId: 'bad', attempt: 0, previous: { parentPath: 'C:/arbitrary' } }))
    await expect(store.readIntent()).rejects.toThrow(/Invalid relaunch intent/)
    expect(await readFile(store.catalogPath, 'utf8')).toContain('arbitrary')
  })
})
