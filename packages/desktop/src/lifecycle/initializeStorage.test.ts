import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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

  it('allows two racing initializers without either deleting the committed root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'iCloud-race-')); const bootstrapPath = join(parent, 'control', 'bootstrap.json')
    const [left, right] = await Promise.all([initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 }), initializeStorage({ parentPath: parent, bootstrapPath, minimumFreeBytes: 1 })])
    expect(left.volume.id).toBe(right.volume.id)
    for (const group of ['extensions','knowledge','work','config','secrets','diagnostics','cache']) await expect(stat(join(parent, '.manta-ai', group))).resolves.toBeTruthy()
    expect((await readdir(parent)).filter((name) => name.startsWith('.manta-ai.initializing-'))).toEqual([])
  })

  it('quarantines corrupt owned staging but never touches a foreign similarly named directory', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-stage-')); const foreign = join(parent, '.manta-ai.initializing-foreign'); const corrupt = join(parent, '.manta-ai.initializing-corrupt')
    await mkdir(foreign); await writeFile(join(foreign, 'user.txt'), 'keep'); await mkdir(corrupt); await writeFile(join(corrupt, '.ash-initialization.json'), JSON.stringify({ schemaVersion: 1, transactionId: 'corrupt', finalRoot: join(parent, '.manta-ai'), createdAt: new Date(0).toISOString() }))
    await initializeStorage({ parentPath: parent, bootstrapPath: join(parent, 'bootstrap.json'), minimumFreeBytes: 1 })
    expect(await readFile(join(foreign, 'user.txt'), 'utf8')).toBe('keep')
    expect((await readdir(parent)).some((name) => name.startsWith('.manta-ai.quarantine-corrupt'))).toBe(true)
  })

  it('finishes a complete marker-owned staging directory left by a crashed process', async () => {
    const parent=await mkdtemp(join(tmpdir(),'ash-stage-finish-')); const tx='crashed'; const staging=join(parent,`.manta-ai.initializing-${tx}`); const finalRoot=join(parent,'.manta-ai'); const now=new Date().toISOString()
    await mkdir(staging); await writeFile(join(staging,'.ash-initialization.json'),JSON.stringify({schemaVersion:1,transactionId:tx,finalRoot,createdAt:now})); const groups=['extensions','knowledge','work','config','secrets','diagnostics','cache']; for(const group of groups) await mkdir(join(staging,group)); await mkdir(join(staging,'.ash-backups')); await writeFile(join(staging,'ash-volume.json'),JSON.stringify({schemaVersion:1,volumeId:'crashed-volume',name:'Recovered',state:'active',groups,generation:1,createdAt:now,updatedAt:now}))
    const result=await initializeStorage({parentPath:parent,bootstrapPath:join(parent,'bootstrap.json'),minimumFreeBytes:1}); expect(result.volume.id).toBe('crashed-volume'); expect((await readdir(parent)).includes(`.manta-ai.initializing-${tx}`)).toBe(false)
  })
})
