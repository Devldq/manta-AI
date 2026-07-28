import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localTaskRuntimeDatabasePath, prepareTaskRuntimeDatabase } from './runtime-state.js'

describe('prepareTaskRuntimeDatabase', () => {
  it('creates a new local runtime database location without touching routed storage', async () => {
    const home = await mkdtemp(join(tmpdir(), 'manta-service-home-'))
    const prepared = await prepareTaskRuntimeDatabase({
      home,
      legacyDatabasePath: join(home, 'missing', 'jobs.sqlite'),
    })

    expect(prepared).toEqual({
      databasePath: localTaskRuntimeDatabasePath(home),
      source: 'new',
    })
  })

  it('atomically migrates the legacy database and WAL while retaining the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-service-migrate-'))
    const home = join(root, 'home')
    const legacyDatabasePath = join(root, 'routed-work', 'jobs.sqlite')
    await mkdir(dirname(legacyDatabasePath), { recursive: true })
    await writeFile(legacyDatabasePath, 'database')
    await writeFile(`${legacyDatabasePath}-wal`, 'wal')
    await writeFile(`${legacyDatabasePath}-shm`, 'transient')

    const prepared = await prepareTaskRuntimeDatabase({ home, legacyDatabasePath })

    expect(prepared.source).toBe('migrated')
    expect(await readFile(prepared.databasePath, 'utf8')).toBe('database')
    expect(await readFile(`${prepared.databasePath}-wal`, 'utf8')).toBe('wal')
    expect(await readFile(legacyDatabasePath, 'utf8')).toBe('database')
    expect(JSON.parse(await readFile(join(dirname(prepared.databasePath), 'migration.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      source: legacyDatabasePath,
    })
  })

  it('reuses existing local state and never reimports the legacy database', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manta-service-existing-'))
    const home = join(root, 'home')
    const databasePath = localTaskRuntimeDatabasePath(home)
    await mkdir(dirname(databasePath), { recursive: true })
    await writeFile(databasePath, 'local')
    const legacyDatabasePath = join(root, 'legacy', 'jobs.sqlite')
    await mkdir(dirname(legacyDatabasePath), { recursive: true })
    await writeFile(legacyDatabasePath, 'legacy')

    const prepared = await prepareTaskRuntimeDatabase({ home, legacyDatabasePath })

    expect(prepared.source).toBe('local')
    expect(await readFile(databasePath, 'utf8')).toBe('local')
  })

  it('recovers an empty local directory left before SQLite created its file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'manta-service-empty-local-'))
    const databasePath = localTaskRuntimeDatabasePath(home)
    await mkdir(dirname(databasePath), { recursive: true })

    await expect(prepareTaskRuntimeDatabase({
      home,
      legacyDatabasePath: join(home, 'legacy', 'jobs.sqlite'),
    })).resolves.toEqual({ databasePath, source: 'new' })
  })
})
