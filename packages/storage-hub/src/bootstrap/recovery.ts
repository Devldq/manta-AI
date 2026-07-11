import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AshBootstrap, AshLocationSnapshot } from '@manta/shared'
import { validateBootstrap } from '../domain/invariants'

const committedPhases = new Set(['committing', 'restarting', 'verifying', 'completed'])

export interface RecoveryCandidate {
  name: string
  canonical: boolean
  snapshot: AshBootstrap
}

export function compareRecoveryCandidates(left: RecoveryCandidate, right: RecoveryCandidate): number {
  const generationOrder = right.snapshot.generation - left.snapshot.generation
  if (generationOrder !== 0) return generationOrder
  if (left.canonical !== right.canonical) return left.canonical ? -1 : 1
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

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

async function parseCandidate(filePath: string, name: string, canonical: boolean): Promise<RecoveryCandidate | undefined> {
  try {
    return { name, canonical, snapshot: effectiveSnapshot(validateBootstrap(JSON.parse(await readFile(filePath, 'utf8')))) }
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
    .map((name) => parseCandidate(join(dirname(filePath), name), name, name === base))
  const valid = (await Promise.all(candidates)).filter((value): value is RecoveryCandidate => value !== undefined)
  return valid.sort(compareRecoveryCandidates)[0]?.snapshot
}
