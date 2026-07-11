import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink } from 'node:fs/promises'
import { join } from 'node:path'

export type InventoryKind = 'file' | 'directory' | 'symlink'
export interface FileInventoryEntry { relativePath: string; kind: InventoryKind; size: number; sha256?: string; linkTarget?: string }
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
      if (stats.isSymbolicLink()) entries.push({ relativePath, kind: 'symlink', size: stats.size, linkTarget: await readlink(absolute) })
      else if (stats.isDirectory()) { entries.push({ relativePath, kind: 'directory', size: 0 }); await walk(absolute, relativePath) }
      else if (stats.isFile()) entries.push({ relativePath, kind: 'file', size: stats.size, sha256: await digest(absolute) })
    }
  }
  await walk(root, '')
  return { root, entries, files: entries.filter((entry) => entry.kind === 'file').length, bytes: entries.reduce((total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0) }
}
