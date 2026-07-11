import { readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AshBootstrap, AshLocationSnapshot } from '@manta/shared'
import { validateBootstrap } from '../domain/invariants'

const committedPhases = new Set(['committing', 'restarting', 'verifying', 'completed'])

function effectiveSnapshot(value: AshBootstrap): AshBootstrap {
  if (!value.pendingMigration || committedPhases.has(value.pendingMigration.phase) || !value.previous) return value
  const previous: AshLocationSnapshot = value.previous
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
