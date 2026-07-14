import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectWindowsLinks } from './windows-link-type'

export type InventoryKind = 'file' | 'directory' | 'symlink'
export type LinkType = 'file' | 'directory' | 'junction' | 'unknown'
export type AllocationEvidence = 'posix-blocks' | 'windows-compressed-size' | 'unavailable'
export interface FileInventoryEntry { relativePath: string; kind: InventoryKind; size: number; allocatedBytes?: number; allocationEvidence?: AllocationEvidence; sha256?: string; linkTarget?: string; linkType?: LinkType }
export interface StorageInventory { root: string; entries: FileInventoryEntry[]; files: number; bytes: number }

export function posixAllocatedBytes(blocks: unknown): number | undefined {
  if (typeof blocks !== 'number' || !Number.isSafeInteger(blocks) || blocks < 0) return undefined
  const bytes = blocks * 512
  return Number.isSafeInteger(bytes) ? bytes : undefined
}

async function digest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', resolve))
  return hash.digest('hex')
}

export async function inventoryTree(root: string): Promise<StorageInventory> {
  const entries: FileInventoryEntry[] = []
  const windowsLinks: Array<{ id: string; path: string; entry: FileInventoryEntry }> = []
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name); const relativePath = prefix ? `${prefix}/${name}` : name; const stats = await lstat(absolute)
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(absolute)
        const target = process.platform === 'win32' ? undefined : await stat(absolute).then((value) => value.isFile() ? 'file' as const : value.isDirectory() ? 'directory' as const : 'unknown' as const, () => 'unknown' as const)
        const entry: FileInventoryEntry = { relativePath, kind: 'symlink', size: stats.size, linkTarget, linkType: target }; entries.push(entry); if (process.platform === 'win32') windowsLinks.push({ id: relativePath, path: absolute, entry })
      }
      else if (stats.isDirectory()) { entries.push({ relativePath, kind: 'directory', size: 0 }); await walk(absolute, relativePath) }
      else if (stats.isFile()) {
        const blocks = process.platform !== 'win32' ? posixAllocatedBytes(stats.blocks) : undefined
        entries.push({ relativePath, kind: 'file', size: stats.size, ...(blocks === undefined ? { allocationEvidence: 'unavailable' as const } : { allocatedBytes: blocks, allocationEvidence: 'posix-blocks' as const }), sha256: await digest(absolute) })
      }
    }
  }
  await walk(root, '')
  if (windowsLinks.length) { const metadata = await inspectWindowsLinks(windowsLinks); for (const link of windowsLinks) { const value = metadata.get(link.id)!; link.entry.linkType = value.linkType === 'Junction' ? 'junction' : value.isContainer ? 'directory' : 'file' } }
  return { root, entries, files: entries.filter((entry) => entry.kind === 'file').length, bytes: entries.reduce((total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0) }
}
