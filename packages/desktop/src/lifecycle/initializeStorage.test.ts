import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { initializeStorage, previewStorageParent } from './initializeStorage'

const STORAGE_GROUPS = ['extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache'] as const

async function createCompleteVolume(root: string, volumeId: string, sentinel: string): Promise<void> {
  const now = new Date().toISOString()
  await mkdir(root)
  for (const group of STORAGE_GROUPS) await mkdir(join(root, group))
  await mkdir(join(root, '.ash-backups'))
  await writeFile(join(root, 'ash-volume.json'), JSON.stringify({
    schemaVersion: 1,
    volumeId,
    name: volumeId,
    state: 'active',
    groups: [...STORAGE_GROUPS],
    generation: 1,
    createdAt: now,
    updatedAt: now,
  }))
  await writeFile(join(root, 'legacy-sentinel.txt'), sentinel)
}

describe('storage initialization', () => {
  it('creates manta-ai-data and all seven groups under an iCloud-like chosen parent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'iCloud Drive-'))
    const bootstrapPath = join(parent, 'control', 'ash-bootstrap.json')
    const result = await initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })
    expect(result.volume.parentPath).toBe(parent)
    for (const group of ['extensions','knowledge','work','config','secrets','diagnostics','cache']) await expect(stat(join(parent, 'manta-ai-data', group))).resolves.toBeTruthy()
    expect(JSON.parse(await readFile(bootstrapPath, 'utf8')).volumes[0].parentPath).toBe(parent)
  })

  it('reports each storage phase only after its real operation boundary succeeds', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-progress-'))
    const events: Array<{ step: string; state: string }> = []

    await initializeStorage({
      parentPath: parent,
      bootstrapPath: join(parent, 'control', 'ash-bootstrap.json'),
      minimumFreeBytes: 1,
      onProgress: (event) => events.push(event),
    })

    expect(events).toEqual([
      { step: 'validate-parent', state: 'active' },
      { step: 'validate-parent', state: 'complete' },
      { step: 'create-volume', state: 'active' },
      { step: 'create-volume', state: 'complete' },
      { step: 'create-groups', state: 'active' },
      { step: 'create-groups', state: 'complete' },
      { step: 'write-manifest', state: 'active' },
      { step: 'write-manifest', state: 'complete' },
      { step: 'commit-bootstrap', state: 'active' },
      { step: 'commit-bootstrap', state: 'complete' },
      { step: 'verify-storage', state: 'active' },
      { step: 'verify-storage', state: 'complete' },
    ])
  })

  it('marks the real failing storage phase and does not report later phases', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-progress-failure-'))
    const bootstrapPath = join(parent, 'control', 'ash-bootstrap.json')
    await mkdir(join(parent, 'control'), { recursive: true })
    await writeFile(bootstrapPath, JSON.stringify({
      schemaVersion: 1,
      generation: 1,
      volumes: [{ id: 'other', name: 'Other', parentPath: '/other', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      groupAssignments: Object.fromEntries(['extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache'].map((group) => [group, 'other'])),
    }))
    const events: Array<{ step: string; state: string }> = []

    await expect(initializeStorage({
      parentPath: parent,
      bootstrapPath,
      minimumFreeBytes: 1,
      onProgress: (event) => events.push(event),
    })).rejects.toMatchObject({ code: 'BOOTSTRAP_CONFLICT' })

    expect(events.at(-1)).toEqual({ step: 'commit-bootstrap', state: 'failed' })
    expect(events).not.toContainEqual({ step: 'verify-storage', state: 'active' })
  })

  it('rejects relative paths, existing ordinary roots, and insufficient space', async () => {
    await expect(previewStorageParent('relative/path')).resolves.toMatchObject({ ok: false })
    const parent = await mkdtemp(join(tmpdir(), 'ash-parent-'))
    await expect(initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'b.json'), minimumFreeBytes: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' })
  })

  it('does not mark parent validation complete when preview rejects the location', async () => {
    const events: Array<{ step: string; state: string }> = []

    await expect(initializeStorage({
      parentPath: 'relative/path',
      bootstrapPath: '/tmp/unused-bootstrap.json',
      onProgress: (event) => events.push(event),
    })).rejects.toMatchObject({ code: 'INVALID_PATH' })

    expect(events).toEqual([
      { step: 'validate-parent', state: 'active' },
      { step: 'validate-parent', state: 'failed' },
    ])
  })

  it('reports an unwritable parent with a stable error code', async () => {
    const parent=await mkdtemp(join(tmpdir(),'ash-unwritable-')); const result=await previewStorageParent(parent,1,{probe:async()=>{throw Object.assign(new Error('access denied'),{code:'EACCES'})}})
    expect(result).toMatchObject({ok:false,error:{code:'UNWRITABLE'}})
  })

  it('recovers a complete renamed volume when bootstrap commit was interrupted', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-recover-')); const firstBootstrap = join(parent, 'first.json')
    const first = await initializeStorage({ parentPath: parent, bootstrapPath: firstBootstrap, minimumFreeBytes: 1 })
    const recovered = await initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'recovered.json'), minimumFreeBytes: 1 })
    expect(recovered.volume.id).toBe(first.volume.id)
  })

  it('atomically upgrades the legacy .manta-ai volume directory without replacing its data', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-legacy-upgrade-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    const bootstrapPath = join(parent, 'control', 'ash-bootstrap.json')
    await createCompleteVolume(legacyRoot, 'legacy-volume', 'preserve-me')
    const legacyIdentity = await stat(legacyRoot)

    const initialized = await initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })

    const currentIdentity = await stat(currentRoot)
    expect({ dev: currentIdentity.dev, ino: currentIdentity.ino }).toEqual({ dev: legacyIdentity.dev, ino: legacyIdentity.ino })
    await expect(stat(legacyRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(currentRoot, 'legacy-sentinel.txt'), 'utf8')).resolves.toBe('preserve-me')
    expect(initialized.volume.id).toBe('legacy-volume')
  })

  it('fails closed without modifying either directory when legacy and current volume roots coexist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-legacy-conflict-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    const bootstrapPath = join(parent, 'control', 'ash-bootstrap.json')
    await createCompleteVolume(legacyRoot, 'legacy-volume', 'legacy-data')
    await createCompleteVolume(currentRoot, 'current-volume', 'current-data')

    await expect(initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })).rejects.toMatchObject({
      code: 'LEGACY_VOLUME_CONFLICT',
    })

    await expect(readFile(join(legacyRoot, 'legacy-sentinel.txt'), 'utf8')).resolves.toBe('legacy-data')
    await expect(readFile(join(currentRoot, 'legacy-sentinel.txt'), 'utf8')).resolves.toBe('current-data')
    await expect(readFile(bootstrapPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a legacy/current conflict before free-space validation can mask it', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-conflict-before-space-'))
    await createCompleteVolume(join(parent, '.manta-ai'), 'legacy-volume', 'legacy')
    await createCompleteVolume(join(parent, 'manta-ai-data'), 'current-volume', 'current')

    await expect(initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'bootstrap.json'), minimumFreeBytes: Number.MAX_SAFE_INTEGER })).rejects.toMatchObject({
      code: 'LEGACY_VOLUME_CONFLICT',
    })
  })

  it('recovers an existing legacy volume without running new-volume probe or free-space checks', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-existing-before-probe-'))
    await createCompleteVolume(join(parent, '.manta-ai'), 'legacy-volume', 'legacy')
    const probe = vi.fn(async () => { throw new Error('probe must not run') })

    await expect(initializeStorage({
      parentPath: parent,
      bootstrapPath: join(parent, 'bootstrap.json'),
      minimumFreeBytes: Number.MAX_SAFE_INTEGER,
      validationHooks: { probe },
    })).resolves.toMatchObject({ volume: { id: 'legacy-volume' } })

    expect(probe).not.toHaveBeenCalled()
  })

  it('still runs the write probe when initialization must create a new volume', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-new-volume-probe-'))
    const probe = vi.fn(async () => { throw new Error('access denied') })

    await expect(initializeStorage({
      parentPath: parent,
      bootstrapPath: join(parent, 'bootstrap.json'),
      minimumFreeBytes: 1,
      validationHooks: { probe },
    })).rejects.toMatchObject({ code: 'UNWRITABLE' })

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('allows two racing initializers without either deleting the committed root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'iCloud-race-')); const bootstrapPath = join(parent, 'control', 'bootstrap.json')
    const [left, right] = await Promise.all([initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 }), initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })])
    expect(left.volume.id).toBe(right.volume.id)
    for (const group of ['extensions','knowledge','work','config','secrets','diagnostics','cache']) await expect(stat(join(parent, 'manta-ai-data', group))).resolves.toBeTruthy()
    expect((await readdir(parent)).filter((name) => name.startsWith('manta-ai-data.initializing-'))).toEqual([])
  })

  it('quarantines corrupt owned staging but never touches a foreign similarly named directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-stage-')); const foreign = join(parent, 'manta-ai-data.initializing-foreign'); const corrupt = join(parent, 'manta-ai-data.initializing-corrupt')
    await mkdir(foreign); await writeFile(join(foreign, 'user.txt'), 'keep'); await mkdir(corrupt); await writeFile(join(corrupt, '.ash-initialization.json'), JSON.stringify({ schemaVersion: 1, transactionId: 'corrupt', finalRoot: join(parent, 'manta-ai-data'), createdAt: new Date(0).toISOString() }))
    await initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'bootstrap.json'), minimumFreeBytes: 1 })
    expect(await readFile(join(foreign, 'user.txt'), 'utf8')).toBe('keep')
    expect((await readdir(parent)).some((name) => name.startsWith('manta-ai-data.quarantine-corrupt'))).toBe(true)
  })

  it('finishes a complete marker-owned staging directory left by a crashed process', async () => {
    const parent=await mkdtemp(join(tmpdir(),'ash-stage-finish-')); const tx='crashed'; const staging=join(parent,`manta-ai-data.initializing-${tx}`); const finalRoot=join(parent,'manta-ai-data'); const now=new Date().toISOString()
    await mkdir(staging); await writeFile(join(staging,'.ash-initialization.json'),JSON.stringify({schemaVersion:1,transactionId:tx,finalRoot,createdAt:now})); const groups=['extensions','knowledge','work','config','secrets','diagnostics','cache']; for(const group of groups) await mkdir(join(staging,group)); await mkdir(join(staging,'.ash-backups')); await writeFile(join(staging,'ash-volume.json'),JSON.stringify({schemaVersion:1,volumeId:'crashed-volume',name:'Recovered',state:'active',groups,generation:1,createdAt:now,updatedAt:now}))
    const result=await initializeStorage({parentPath:parent,bootstrapPath:join(parent,'bootstrap.json'),minimumFreeBytes:1}); expect(result.volume.id).toBe('crashed-volume'); expect((await readdir(parent)).includes(`manta-ai-data.initializing-${tx}`)).toBe(false)
  })

  it('rejects a complete backup or archived volume as a new active initialization root', async () => {
    const parent=await mkdtemp(join(tmpdir(),'ash-backup-root-')); const root=join(parent,'manta-ai-data'); const groups=['extensions','knowledge','work','config','secrets','diagnostics','cache']; await mkdir(root); for(const group of groups)await mkdir(join(root,group)); await writeFile(join(root,'ash-volume.json'),JSON.stringify({schemaVersion:1,volumeId:'backup',name:'Backup',state:'backup',groups,generation:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}))
    await expect(initializeStorage({parentPath:parent,bootstrapPath:join(parent,'bootstrap.json'),minimumFreeBytes:1})).rejects.toMatchObject({code:'TARGET_EXISTS'})
  })
})
