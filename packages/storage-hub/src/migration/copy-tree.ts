import { chmod, copyFile, lstat, mkdir, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FileInventoryEntry, StorageInventory } from '../inventory/file-inventory'

function sourcePath(root: string, entry: FileInventoryEntry): string { return join(root, ...entry.relativePath.split('/')) }
function linkCreationType(entry: FileInventoryEntry): 'file' | 'dir' | 'junction' | undefined {
  if (entry.linkType === 'file') return 'file'
  if (entry.linkType === 'directory') return 'dir'
  if (entry.linkType === 'junction') return 'junction'
  return undefined
}

export async function copyTree(source: string, target: string, inventory: StorageInventory, progress?: (files: number, bytes: number) => void): Promise<void> {
  await mkdir(target, { recursive: true }); let files = 0; let bytes = 0
  const ordered = [...inventory.entries].sort((left, right) => Number(left.kind !== 'directory') - Number(right.kind !== 'directory') || left.relativePath.localeCompare(right.relativePath))
  for (const entry of ordered) {
    const from = sourcePath(source, entry); const to = sourcePath(target, entry); await mkdir(dirname(to), { recursive: true })
    if (entry.kind === 'directory') { await mkdir(to, { recursive: true }); await chmod(to, (await lstat(from)).mode) }
    else if (entry.kind === 'file') { const stats = await lstat(from); if (!stats.isFile() || stats.size !== entry.size) throw new Error(`Source changed after inventory: ${entry.relativePath}`); await copyFile(from, to); await chmod(to, stats.mode); files += 1; bytes += entry.size; progress?.(files, bytes) }
    else { if (!entry.linkTarget || entry.linkType === 'unknown') throw new Error(`Cannot faithfully recreate link: ${entry.relativePath}`); await symlink(entry.linkTarget, to, linkCreationType(entry)) }
  }
  if (files !== inventory.files || bytes !== inventory.bytes) throw new Error('Copied byte or file count does not match inventory')
}
