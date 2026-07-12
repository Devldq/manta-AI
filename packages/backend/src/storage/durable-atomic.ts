import { chmodSync, closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
const waitArray = new Int32Array(new SharedArrayBuffer(4))
export function fsyncParentDirectory(file: string): void {
  let fd: number | undefined
  try { fd = openSync(dirname(file), 'r'); fsyncSync(fd) }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes(code ?? '')) throw error
  } finally { if (fd !== undefined) closeSync(fd) }
}
export function durableMkdir(directory: string): void {
  if (existsSync(directory)) return
  const parent = dirname(directory); if (parent !== directory) durableMkdir(parent)
  mkdirSync(directory); fsyncParentDirectory(directory)
}
export function durableRename(source: string, destination: string): void { durableMkdir(dirname(destination)); renameSync(source, destination); fsyncParentDirectory(source); if (dirname(source) !== dirname(destination)) fsyncParentDirectory(destination) }
export function durableRemove(target: string): void { if (!existsSync(target)) return; rmSync(target, { recursive: true, force: true }); fsyncParentDirectory(target) }
export function durableCopy(source: string, destination: string, options: { exclusive?: boolean; expectedHash?: string } = {}): void {
  durableMkdir(dirname(destination)); copyFileSync(source, destination, options.exclusive ? constants.COPYFILE_EXCL : 0); const fd = openSync(destination, 'r+')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  if (statSync(source).size !== statSync(destination).size) throw new Error('Durable copy size mismatch')
  if (options.expectedHash) { const actual = createHash('sha256').update(readFileSync(destination)).digest('hex'); if (actual !== options.expectedHash) throw new Error('Durable copy hash mismatch') }
  fsyncParentDirectory(destination)
}
export function durableFsyncFile(file: string, expectedHash?: string): void {
  if (expectedHash) { const actual = createHash('sha256').update(readFileSync(file)).digest('hex'); if (actual !== expectedHash) throw new Error(`Durable file hash mismatch: expected ${expectedHash}, got ${actual}`) }
  const fd = openSync(file, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) }; fsyncParentDirectory(file)
}
export function durableRecursiveCopy(source: string, destination: string, options: { filter?: (source: string) => boolean; afterCopy?: (source: string) => void } = {}): void {
  const stat = lstatSync(source)
  if (stat.isSymbolicLink()) throw new Error(`Durable recursive copy refuses symbolic links or reparse points: ${source}`)
  if (stat.isDirectory()) {
    durableMkdir(destination)
    for (const name of readdirSync(source)) { const child = join(source, name); if (options.filter?.(child) === false) continue; durableRecursiveCopy(child, join(destination, name), options) }
    chmodSync(destination, stat.mode); utimesSync(destination, stat.atime, stat.mtime); fsyncParentDirectory(join(destination, '.entry'))
    return
  }
  if (!stat.isFile()) throw new Error(`Durable recursive copy refuses non-file entry: ${source}`)
  durableCopy(source, destination); chmodSync(destination, stat.mode); utimesSync(destination, stat.atime, stat.mtime); fsyncParentDirectory(destination); options.afterCopy?.(source)
}
export function durableAtomicWrite(file: string, content: string): void {
  durableMkdir(dirname(file)); const temporary = join(dirname(file), `${basename(file)}.${randomUUID()}.tmp`); const fd = openSync(temporary, 'wx')
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
  for (let attempt = 0; ; attempt++) {
    try { renameSync(temporary, file); break } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 20) throw error
      Atomics.wait(waitArray, 0, 0, 10)
    }
  }
  fsyncParentDirectory(file)
}
