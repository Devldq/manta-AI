import { lstat, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { readOrdinaryNoFollow } from './native-io'

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export interface NativeSkillFile { readonly nativePath: string; readonly relativePath: string; readonly bytes: Uint8Array }
export interface NativeSkill { readonly name: string; readonly directory: string; readonly files: readonly NativeSkillFile[] }

async function files(root: string, current = root): Promise<NativeSkillFile[]> {
  const result: NativeSkillFile[] = []
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!SAFE_NAME.test(entry.name) || entry.isSymbolicLink()) throw new Error('Skill tree contains an unsafe or linked entry')
    const path = join(current, entry.name); const stat = await lstat(path)
    if (stat.isDirectory()) result.push(...await files(root, path))
    else if (stat.isFile()) result.push({ nativePath: path, relativePath: relative(root, path).split(sep).join('/'), bytes: await readOrdinaryNoFollow(path) })
    else throw new Error('Skill tree contains a non-ordinary entry')
  }
  return result
}

export async function discoverSkills(root: string): Promise<NativeSkill[]> {
  const result: NativeSkill[] = []
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isSymbolicLink()) throw new Error('User skill root contains a linked entry')
    if (!entry.isDirectory()) continue
    if (!SAFE_NAME.test(entry.name)) throw new Error('User skill root contains an unsafe skill name')
    const directory = join(root, entry.name); const manifest = join(directory, 'SKILL.md'); let stat
    try { stat = await lstat(manifest) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Skill manifest must be an ordinary non-linked file')
    result.push({ name: basename(directory), directory, files: await files(directory) })
  }
  return result
}

async function ordinaryPaths(current: string): Promise<string[]> { const result: string[] = []; for (const entry of await readdir(current, { withFileTypes: true })) { if (!SAFE_NAME.test(entry.name) || entry.isSymbolicLink()) throw new Error('Skill tree contains an unsafe or linked entry'); const path = join(current, entry.name); const stat = await lstat(path); if (stat.isDirectory()) result.push(...await ordinaryPaths(path)); else if (stat.isFile()) result.push(path); else throw new Error('Skill tree contains a non-ordinary entry') } return result }
export async function listSkillFilePaths(root: string): Promise<string[]> { const result: string[] = []; for (const entry of await readdir(root, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('User skill root contains a linked entry'); if (!entry.isDirectory()) continue; if (!SAFE_NAME.test(entry.name)) throw new Error('User skill root contains an unsafe skill name'); const directory = join(root, entry.name); const manifest = await lstat(join(directory, 'SKILL.md')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error)); if (!manifest) continue; if (!manifest.isFile() || manifest.isSymbolicLink()) throw new Error('Skill manifest must be an ordinary non-linked file'); result.push(...await ordinaryPaths(directory)) } return result.sort((a, b) => a < b ? -1 : a > b ? 1 : 0) }
