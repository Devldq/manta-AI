import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AshBootstrap } from '@manta/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { BootstrapStore } from './bootstrap-store'
import { recoverBootstrap } from './recovery'

const dirs: string[] = []
const groups = { extensions: 'v1', knowledge: 'v1', work: 'v1', config: 'v1', secrets: 'v1', diagnostics: 'v1', cache: 'v1' } as const
const snapshot = (generation = 1): AshBootstrap => ({ schemaVersion: 1, generation, volumes: [{ id: 'v1', name: 'main', parentPath: '/data', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], groupAssignments: groups })

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
})

describe('recoverBootstrap', () => {
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
})
