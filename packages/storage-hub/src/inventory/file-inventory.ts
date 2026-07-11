import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectWindowsLink } from './windows-link-type'

export type InventoryKind = 'file' | 'directory' | 'symlink'
export type LinkType = 'file' | 'directory' | 'junction' | 'unknown'
export interface FileInventoryEntry { relativePath: string; kind: InventoryKind; size: number; sha256?: string; linkTarget?: string; linkType?: LinkType }
export interface StorageInventory { root: string; entries: FileInventoryEntry[]; files: number; bytes: number }

async function digest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', resolve))
  return hash.digest('hex')
}

export async function inventoryTree(root: string): Promise<StorageInventory> {
  const entries: FileInventoryEntry[] = []
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name); const relativePath = prefix ? `${prefix}/${name}` : name; const stats = await lstat(absolute)
      if (stats.isSymbolicLink()) {
        const linkTarget = await readlink(absolute)
        const target = process.platform === 'win32'
          ? await inspectWindowsLink(absolute).then((value) => value.linkType === 'Junction' ? 'junction' as const : value.isContainer ? 'directory' as const : 'file' as const)
          : await stat(absolute).then((value) => value.isFile() ? 'file' as const : value.isDirectory() ? 'directory' as const : 'unknown' as const, () => 'unknown' as const)
        entries.push({ relativePath, kind: 'symlink', size: stats.size, linkTarget, linkType: target })
      }
      else if (stats.isDirectory()) { entries.push({ relativePath, kind: 'directory', size: 0 }); await walk(absolute, relativePath) }
      else if (stats.isFile()) entries.push({ relativePath, kind: 'file', size: stats.size, sha256: await digest(absolute) })
    }
  }
  await walk(root, '')
  return { root, entries, files: entries.filter((entry) => entry.kind === 'file').length, bytes: entries.reduce((total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0) }
}
