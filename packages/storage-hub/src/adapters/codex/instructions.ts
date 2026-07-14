import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { readOrdinaryNoFollow } from './native-io'

export async function activeInstructions(codexHome: string): Promise<{ nativePath: string; fileName: string; bytes: Uint8Array } | undefined> {
  for (const candidate of await instructionFiles(codexHome)) if (Buffer.from(candidate.bytes).toString().trim().length) return candidate
  return undefined
}

export async function instructionFiles(codexHome: string): Promise<{ nativePath: string; fileName: string; bytes: Uint8Array }[]> {
  const result = []
  for (const fileName of ['AGENTS.override.md', 'AGENTS.md']) {
    const nativePath = join(codexHome, fileName); let stat
    try { stat = await lstat(nativePath) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Codex global instructions must be an ordinary file')
    const bytes = await readOrdinaryNoFollow(nativePath); result.push({ nativePath, fileName, bytes })
  }
  return result
}

export async function instructionFilePaths(codexHome: string): Promise<string[]> { const result: string[] = []; for (const fileName of ['AGENTS.override.md', 'AGENTS.md']) { const nativePath = join(codexHome, fileName); const stat = await lstat(nativePath).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error)); if (!stat) continue; if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Codex global instructions must be an ordinary file'); result.push(nativePath) } return result }
