import { readFile } from 'node:fs/promises'
import type { AshBootstrap, AshLocationSnapshot } from '@manta/shared'
import { validateBootstrap } from '../domain/invariants'
import { writeJsonAtomic } from './atomic-json'

function snapshot(value: AshBootstrap): AshLocationSnapshot {
  return { generation: value.generation, volumes: value.volumes, groupAssignments: value.groupAssignments }
}

export class BootstrapStore {
  constructor(readonly filePath: string) {}

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
    const current = await this.read()
    if (!current) throw new Error('Bootstrap does not exist')
    const updated = validateBootstrap(await updater(current))
    const next = validateBootstrap({ ...updated, previous: snapshot(current) })
    await this.write(next)
    return next
  }
}
