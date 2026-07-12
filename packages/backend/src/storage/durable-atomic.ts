import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
const waitArray = new Int32Array(new SharedArrayBuffer(4))
export function fsyncParentDirectory(file: string): void {
  let fd: number | undefined
  try { fd = openSync(dirname(file), 'r'); fsyncSync(fd) }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EBADF'].includes(code ?? '')) throw error
  } finally { if (fd !== undefined) closeSync(fd) }
}
export function durableAtomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true }); const temporary = join(dirname(file), `${basename(file)}.${randomUUID()}.tmp`); const fd = openSync(temporary, 'wx')
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
  for (let attempt = 0; ; attempt++) {
    try { renameSync(temporary, file); break } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 20) throw error
      Atomics.wait(waitArray, 0, 0, 10)
    }
  }
  fsyncParentDirectory(file)
}
