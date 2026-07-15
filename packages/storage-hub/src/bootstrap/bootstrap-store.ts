import { readFile } from 'node:fs/promises'
import type { AshBootstrap, AshLocationSnapshot } from '@manta/shared'
import { validateBootstrap } from '../domain/invariants'
import { acquireMigrationFileLock } from '../migration/migration-lock'
import { writeJsonAtomic } from './atomic-json'

function snapshot(value: AshBootstrap): AshLocationSnapshot {
  return { generation: value.generation, volumes: value.volumes, groupAssignments: value.groupAssignments }
}

export class BootstrapStore {
  constructor(readonly filePath: string, private readonly options: { lockTimeoutMs?: number; lockRetryDelayMs?: number } = {}) {}

  async read(): Promise<AshBootstrap | undefined> {
    try { return validateBootstrap(JSON.parse(await readFile(this.filePath, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  async write(value: AshBootstrap): Promise<void> {
    await writeJsonAtomic(this.filePath, validateBootstrap(value))
  }

  async update(updater: (value: AshBootstrap) => AshBootstrap | Promise<AshBootstrap>): Promise<AshBootstrap> {
    const lock = await acquireMigrationFileLock(this.filePath, { waitTimeoutMs: this.options.lockTimeoutMs ?? 30_000, retryDelayMs: this.options.lockRetryDelayMs })
    try {
      const current = await this.read()
      if (!current) throw new Error('Bootstrap does not exist')
      const updated = validateBootstrap(await updater(current))
      if (updated.generation !== current.generation + 1) throw new Error(`Bootstrap generation must advance from ${current.generation} to ${current.generation + 1}`)
      const next = validateBootstrap({ ...updated, previous: snapshot(current) })
      await this.write(next)
      return next
    } finally { await lock.release() }
  }
}
