import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AshBootstrap } from '@manta/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { BootstrapStore } from './bootstrap-store'
import { compareRecoveryCandidates, recoverBootstrap } from './recovery'

const dirs: string[] = []
const groups = { extensions: 'v1', knowledge: 'v1', work: 'v1', config: 'v1', secrets: 'v1', diagnostics: 'v1', cache: 'v1' } as const
const snapshot = (generation = 1): AshBootstrap => ({ schemaVersion: 1, generation, volumes: [{ id: 'v1', name: 'main', parentPath: '/data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: groups })
const journal = (phase: AshBootstrap['pendingMigration'] extends infer _ ? 'planned' | 'quiescing' | 'copying' | 'validating' | 'committing' | 'restarting' | 'verifying' | 'completed' | 'rolling-back' | 'failed' : never, sourceGeneration = 1, targetGeneration = 2) => ({ id: 'm1', kind: 'volume' as const, sourceVolumeId: 'v1', targetParentPath: '/new', groups: ['work' as const], sourceGeneration, targetGeneration, phase, filesCompleted: 0, filesTotal: 1, bytesCompleted: 0, bytesTotal: 1 })

afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))))
async function fresh(): Promise<string> { const dir = await mkdtemp(path.join(tmpdir(), 'ash-bootstrap-')); dirs.push(dir); return dir }

describe('BootstrapStore', () => {
  it('returns undefined when bootstrap is missing', async () => {
    expect(await new BootstrapStore(path.join(await fresh(), 'bootstrap.json')).read()).toBeUndefined()
  })

  it('rejects an invalid schema', async () => {
    const file = path.join(await fresh(), 'bootstrap.json')
    await writeFile(file, JSON.stringify({ ...snapshot(), schemaVersion: 2 }))
    await expect(new BootstrapStore(file).read()).rejects.toThrow()
  })

  it('atomically writes and updates bootstrap while retaining previous snapshot', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json'); const store = new BootstrapStore(file)
    await store.write(snapshot())
    await store.update((value) => ({ ...value, generation: 2 }))
    const value = JSON.parse(await readFile(file, 'utf8')) as AshBootstrap
    expect(value.generation).toBe(2)
    expect(value.previous?.generation).toBe(1)
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('serializes updates from independent store instances without losing either update', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json')
    const first = new BootstrapStore(file); const second = new BootstrapStore(file)
    await first.write(snapshot())
    let releaseFirst!: () => void; let enteredFirst!: () => void
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const updateOne = first.update(async (current) => {
      enteredFirst(); await firstGate
      return { ...current, generation: current.generation + 1, volumes: [...current.volumes, { ...current.volumes[0], id: 'v2', name: 'second', parentPath: '/second' }] }
    })
    await firstEntered
    let secondEntered = false
    const updateTwo = second.update((current) => {
      secondEntered = true
      return { ...current, generation: current.generation + 1, volumes: [...current.volumes, { ...current.volumes[0], id: 'v3', name: 'third', parentPath: '/third' }] }
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const overlapped = secondEntered
    releaseFirst(); await Promise.all([updateOne, updateTwo])
    const value = await first.read()
    expect(overlapped).toBe(false)
    expect(value?.generation).toBe(3)
    expect(value?.volumes.map(({ id }) => id)).toEqual(['v1', 'v2', 'v3'])
    expect(value?.previous?.generation).toBe(2)
  })
})

describe('recoverBootstrap', () => {
  it('orders equal-generation recovery candidates independently of enumeration order', () => {
    const candidates = [
      { name: 'bootstrap.json.z.tmp', canonical: false, snapshot: snapshot(2) },
      { name: 'bootstrap.json.a.tmp', canonical: false, snapshot: snapshot(2) },
      { name: 'bootstrap.json', canonical: true, snapshot: snapshot(2) },
    ]
    expect(candidates.sort(compareRecoveryCandidates).map(({ name }) => name)).toEqual([
      'bootstrap.json',
      'bootstrap.json.a.tmp',
      'bootstrap.json.z.tmp',
    ])
  })

  it('selects the highest-generation valid interrupted snapshot without using mtime', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json')
    await writeFile(file, JSON.stringify(snapshot(1)))
    await writeFile(`${file}.unique.tmp`, JSON.stringify(snapshot(3)))
    await writeFile(`${file}.bad.tmp`, JSON.stringify({ ...snapshot(9), schemaVersion: 9 }))
    expect((await recoverBootstrap(file))?.generation).toBe(3)
  })

  it('uses previous state for a migration interrupted before commit', async () => {
    const file = path.join(await fresh(), 'bootstrap.json')
    const current = snapshot(2)
    await writeFile(file, JSON.stringify({ ...current, previous: { ...snapshot(1), schemaVersion: undefined }, pendingMigration: { id: 'm1', kind: 'volume', sourceVolumeId: 'v1', targetParentPath: '/new', groups: ['work'], sourceGeneration: 1, targetGeneration: 2, phase: 'copying', filesCompleted: 0, filesTotal: 1, bytesCompleted: 0, bytesTotal: 1 } }))
    expect((await recoverBootstrap(file))?.generation).toBe(1)
  })

  it('rejects a pre-commit candidate whose previous snapshot violates invariants', async () => {
    const file = path.join(await fresh(), 'bootstrap.json')
    const current = snapshot(2)
    const previous = { ...snapshot(1), schemaVersion: undefined, volumes: [...snapshot(1).volumes, { ...snapshot(1).volumes[0], parentPath: '/other' }] }
    await writeFile(file, JSON.stringify({ ...current, previous, pendingMigration: { id: 'm1', kind: 'volume', sourceVolumeId: 'v1', targetParentPath: '/new', groups: ['work'], sourceGeneration: 1, targetGeneration: 2, phase: 'copying', filesCompleted: 0, filesTotal: 1, bytesCompleted: 0, bytesTotal: 1 } }))
    expect(await recoverBootstrap(file)).toBeUndefined()
  })

  it.each(['planned', 'quiescing', 'copying', 'validating', 'rolling-back', 'failed'] as const)('rejects %s without previous', async (phase) => {
    const file = path.join(await fresh(), 'bootstrap.json')
    await writeFile(file, JSON.stringify({ ...snapshot(2), pendingMigration: journal(phase) }))
    expect(await recoverBootstrap(file)).toBeUndefined()
  })

  it('rejects inconsistent pre-commit journal generations', async () => {
    const file = path.join(await fresh(), 'bootstrap.json')
    await writeFile(file, JSON.stringify({ ...snapshot(4), previous: { ...snapshot(1), schemaVersion: undefined }, pendingMigration: journal('copying', 1, 2) }))
    expect(await recoverBootstrap(file)).toBeUndefined()
  })

  it.each(['committing', 'restarting', 'verifying', 'completed'] as const)('rejects inconsistent %s generations', async (phase) => {
    const file = path.join(await fresh(), 'bootstrap.json')
    await writeFile(file, JSON.stringify({ ...snapshot(3), previous: { ...snapshot(1), schemaVersion: undefined }, pendingMigration: journal(phase, 1, 2) }))
    expect(await recoverBootstrap(file)).toBeUndefined()
  })

  it('prefers a committed canonical snapshot over a newer-mtime stale temp by effective generation', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json'); const stale = `${file}.stale.tmp`
    await writeFile(file, JSON.stringify({ ...snapshot(4), pendingMigration: journal('completed', 3, 4) }))
    await writeFile(stale, JSON.stringify(snapshot(3)))
    await utimes(file, new Date(0), new Date(0)); await utimes(stale, new Date(), new Date())
    expect((await recoverBootstrap(file))?.generation).toBe(4)
  })

  it('prefers canonical over a conflicting valid temp at the same effective generation', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json')
    await writeFile(`${file}.a.tmp`, JSON.stringify({ ...snapshot(2), volumes: [{ ...snapshot(2).volumes[0], name: 'temp' }] }))
    await writeFile(file, JSON.stringify({ ...snapshot(2), volumes: [{ ...snapshot(2).volumes[0], name: 'canonical' }] }))
    expect((await recoverBootstrap(file))?.volumes[0].name).toBe('canonical')
  })

  it('uses ascending filename order for equal-generation temps without canonical', async () => {
    const dir = await fresh(); const file = path.join(dir, 'bootstrap.json')
    await writeFile(`${file}.z.tmp`, JSON.stringify({ ...snapshot(2), volumes: [{ ...snapshot(2).volumes[0], name: 'z-temp' }] }))
    await writeFile(`${file}.a.tmp`, JSON.stringify({ ...snapshot(2), volumes: [{ ...snapshot(2).volumes[0], name: 'a-temp' }] }))
    expect((await recoverBootstrap(file))?.volumes[0].name).toBe('a-temp')
  })
})
