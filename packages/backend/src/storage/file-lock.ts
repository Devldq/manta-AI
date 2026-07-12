import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

interface Owner { version: 1; token: string; pid: number; processIdentity: string; createdAt: string }
export interface FileLockOptions { timeoutMs?: number; backoffMs?: number; inspectProcess?: (pid: number) => { alive: boolean; identity?: string } }
const waitArray = new Int32Array(new SharedArrayBuffer(4)); let selfIdentity: string | undefined
const pause = (ms: number) => Atomics.wait(waitArray, 0, 0, ms)
function parse(text: string): Owner | undefined { try { const value = JSON.parse(text) as Owner; return value.version === 1 && typeof value.token === 'string' && Number.isInteger(value.pid) && typeof value.processIdentity === 'string' ? value : undefined } catch { return undefined } }
function inspect(pid: number): { alive: boolean; identity?: string } {
  try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false }; return { alive: true } }
  try {
    if (process.platform === 'win32') { const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()`], { encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: tmpdir(), TMP: tmpdir() } }).trim(); return { alive: true, identity: value ? `win32:${value}` : undefined } }
    if (process.platform === 'linux') { const text = readFileSync(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(') ') + 2).split(' '); return { alive: true, identity: fields[19] ? `linux:${fields[19]}` : undefined } }
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim(); return { alive: true, identity: value ? `${process.platform}:${value}` : undefined }
  } catch { return { alive: true } }
}
selfIdentity = inspect(process.pid).identity
function ownerAt(path: string): Owner | undefined { try { return parse(readFileSync(path, 'utf8')) } catch { return undefined } }
function removeOwned(path: string, token: string, required: boolean): boolean {
  const owner = ownerAt(path); if (!owner) { if (required) throw new Error('Storage file lock has unknown owner'); return false } if (owner.token !== token) return false
  const claim = `${path}.claim-${token}`; try { renameSync(path, claim) } catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
  if (ownerAt(claim)?.token !== token) { try { renameSync(claim, path) } catch { /* fail closed */ } if (required) throw new Error('Storage file lock ownership changed'); return false }
  unlinkSync(claim); return true
}
export function acquireStorageFileLock(path: string, options: FileLockOptions = {}): () => void {
  const timeoutMs = options.timeoutMs ?? 500; const backoffMs = options.backoffMs ?? 20; const inspectProcess = options.inspectProcess ?? inspect; const deadline = Date.now() + timeoutMs
  const self = options.inspectProcess ? inspectProcess(process.pid) : (() => { if (!selfIdentity) selfIdentity = inspect(process.pid).identity; return { alive: true, identity: selfIdentity } })()
  if (!self.identity) throw new Error('Storage file lock process identity is unavailable')
  while (true) {
    let fd: number | undefined
    try { fd = openSync(path, 'wx') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = ownerAt(path)
      if (!owner) { if (Date.now() >= deadline) throw new Error('Storage file lock has unknown owner'); pause(backoffMs); continue }
      const state = inspectProcess(owner.pid)
      if (state.alive && !state.identity) throw new Error('Storage file lock process identity is unavailable; refusing stale recovery')
      if (!state.alive || state.identity !== owner.processIdentity) { removeOwned(path, owner.token, true); continue }
      if (Date.now() >= deadline) throw new Error('Storage file lock acquisition timed out')
      pause(backoffMs); continue
    }
    const owner: Owner = { version: 1, token: randomUUID(), pid: process.pid, processIdentity: self.identity, createdAt: new Date().toISOString() }
    try { writeFileSync(fd, JSON.stringify(owner)); fsyncSync(fd) } catch (error) { closeSync(fd); try { unlinkSync(path) } catch { /* best effort */ } throw error }
    let released = false
    return () => { if (released) return; released = true; closeSync(fd!); removeOwned(path, owner.token, false) }
  }
}
