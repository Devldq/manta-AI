import { copyFile, chmod, lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StorageInventory } from '../inventory/file-inventory'

export async function copyTree(source: string, target: string, inventory: StorageInventory, progress?: (files: number, bytes: number) => void): Promise<void> {
  await mkdir(target, { recursive: true })
  let files = 0; let bytes = 0
  async function walk(from: string, to: string): Promise<void> {
    for (const name of (await readdir(from)).sort()) {
      const sourcePath = join(from, name); const targetPath = join(to, name); const stats = await lstat(sourcePath)
      if (stats.isSymbolicLink()) { await mkdir(dirname(targetPath), { recursive: true }); await symlink(await readlink(sourcePath), targetPath, process.platform === 'win32' ? 'junction' : undefined) }
      else if (stats.isDirectory()) { await mkdir(targetPath, { recursive: true }); await chmod(targetPath, stats.mode); await walk(sourcePath, targetPath) }
      else if (stats.isFile()) { await copyFile(sourcePath, targetPath); await chmod(targetPath, stats.mode); files += 1; bytes += stats.size; progress?.(files, bytes) }
    }
  }
  await walk(source, target)
  if (files !== inventory.files || bytes !== inventory.bytes) throw new Error('Copied byte or file count does not match inventory')
}
