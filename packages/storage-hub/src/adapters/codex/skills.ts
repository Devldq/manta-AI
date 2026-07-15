import { lstat, readdir } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { readOrdinaryNoFollow } from './native-io'

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
export interface NativeSkillFile { readonly nativePath: string; readonly relativePath: string; readonly bytes: Uint8Array }
export interface NativeSkill { readonly name: string; readonly directory: string; readonly files: readonly NativeSkillFile[] }
interface SkillTraversalHooks { afterDirectoryRead?(path: string): Promise<void> }
interface DirectoryEvidence { readonly path: string; readonly identity: string }

async function directoryEvidence(path: string): Promise<DirectoryEvidence> { const stat = await lstat(path, { bigint: true }); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skill traversal ancestor is linked or not an ordinary directory'); return { path, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` } }
async function verifyDirectories(chain: readonly DirectoryEvidence[]): Promise<void> { for (const evidence of chain) { const current = await directoryEvidence(evidence.path); if (current.identity !== evidence.identity) throw new Error('Skill traversal ancestor identity changed') } }
async function entries(path: string, chain: readonly DirectoryEvidence[], hooks?: SkillTraversalHooks) { await verifyDirectories(chain); const result = await readdir(path, { withFileTypes: true }); await hooks?.afterDirectoryRead?.(path); await verifyDirectories(chain); return result.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) }

async function walkFiles(root: string, current: string, chain: readonly DirectoryEvidence[], readBytes: boolean, hooks?: SkillTraversalHooks): Promise<{ nativePath: string; relativePath: string; bytes?: Uint8Array }[]> {
  const result: { nativePath: string; relativePath: string; bytes?: Uint8Array }[] = []
  for (const entry of await entries(current, chain, hooks)) {
    if (!SAFE_NAME.test(entry.name) || entry.isSymbolicLink()) throw new Error('Skill tree contains an unsafe or linked entry')
    const path = join(current, entry.name); const stat = await lstat(path); await verifyDirectories(chain)
    if (stat.isDirectory()) { const evidence = await directoryEvidence(path); await verifyDirectories(chain); result.push(...await walkFiles(root, path, [...chain, evidence], readBytes, hooks)) }
    else if (stat.isFile()) { await verifyDirectories(chain); const bytes = readBytes ? await readOrdinaryNoFollow(path) : undefined; await verifyDirectories(chain); result.push({ nativePath: path, relativePath: relative(root, path).split(sep).join('/'), ...(bytes ? { bytes } : {}) }) }
    else throw new Error('Skill tree contains a non-ordinary entry')
  }
  return result
}

async function skillDirectories(root: string, rootEvidence: DirectoryEvidence, hooks?: SkillTraversalHooks): Promise<{ name: string; directory: string; evidence: DirectoryEvidence }[]> {
  const result: { name: string; directory: string; evidence: DirectoryEvidence }[] = []
  for (const entry of await entries(root, [rootEvidence], hooks)) {
    if (entry.isSymbolicLink()) throw new Error('User skill root contains a linked entry')
    if (!entry.isDirectory()) continue
    if (!SAFE_NAME.test(entry.name)) throw new Error('User skill root contains an unsafe skill name')
    const directory = join(root, entry.name); const evidence = await directoryEvidence(directory); await verifyDirectories([rootEvidence]); const manifest = join(directory, 'SKILL.md'); let stat
    try { stat = await lstat(manifest) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await verifyDirectories([rootEvidence, evidence]); continue }; throw error }
    await verifyDirectories([rootEvidence, evidence]); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Skill manifest must be an ordinary non-linked file')
    result.push({ name: basename(directory), directory, evidence })
  }
  return result
}

export async function discoverSkillsWithHooks(root: string, hooks?: SkillTraversalHooks): Promise<NativeSkill[]> {
  const rootEvidence = await directoryEvidence(root); const result: NativeSkill[] = []
  for (const skill of await skillDirectories(root, rootEvidence, hooks)) { const files = await walkFiles(skill.directory, skill.directory, [rootEvidence, skill.evidence], true, hooks); result.push({ name: skill.name, directory: skill.directory, files: files.map((file) => ({ nativePath: file.nativePath, relativePath: file.relativePath, bytes: file.bytes! })) }) }
  await verifyDirectories([rootEvidence]); return result
}

export async function discoverSkills(root: string): Promise<NativeSkill[]> { return discoverSkillsWithHooks(root) }

export async function listSkillFilePaths(root: string): Promise<string[]> { const rootEvidence = await directoryEvidence(root); const result: string[] = []; for (const skill of await skillDirectories(root, rootEvidence)) result.push(...(await walkFiles(skill.directory, skill.directory, [rootEvidence, skill.evidence], false)).map((file) => file.nativePath)); await verifyDirectories([rootEvidence]); return result.sort((a, b) => a < b ? -1 : a > b ? 1 : 0) }
