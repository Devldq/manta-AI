import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AshBootstrap, AshLocationSnapshot } from '@manta/shared'
import { validateBootstrap } from '../domain/invariants'

const committedPhases = new Set(['committing', 'restarting', 'verifying', 'completed'])

function effectiveSnapshot(value: AshBootstrap): AshBootstrap {
  const journal = value.pendingMigration
  if (!journal) return value
  if (journal.targetGeneration !== journal.sourceGeneration + 1 || value.generation !== journal.targetGeneration) {
    throw new Error('Migration generations are inconsistent')
  }
  const previous: AshLocationSnapshot | undefined = value.previous
  if (previous && previous.generation !== journal.sourceGeneration) throw new Error('Previous generation is inconsistent')
  if (committedPhases.has(journal.phase)) return value
  if (!previous) throw new Error('Pre-commit migration requires previous state')
  return validateBootstrap({ schemaVersion: 1, ...previous })
}

async function parseCandidate(filePath: string): Promise<AshBootstrap | undefined> {
  try {
    return effectiveSnapshot(validateBootstrap(JSON.parse(await readFile(filePath, 'utf8'))))
  } catch {
    return undefined
  }
}

export async function recoverBootstrap(filePath: string): Promise<AshBootstrap | undefined> {
  let names: string[]
  try { names = await readdir(dirname(filePath)) } catch { return undefined }
  const base = basename(filePath)
  const candidates = names
    .filter((name) => name === base || (name.startsWith(`${base}.`) && name.endsWith('.tmp')))
    .map((name) => parseCandidate(join(dirname(filePath), name)))
  const valid = (await Promise.all(candidates)).filter((value): value is AshBootstrap => value !== undefined)
  return valid.sort((a, b) => b.generation - a.generation)[0]
}
