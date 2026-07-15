import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync, fsyncSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

interface Owner { version: 1; token: string; pid: number; processIdentity: string; createdAt: string; targetStaleToken?: string }
export interface FileLockOptions { timeoutMs?: number; backoffMs?: number; inspectProcess?: (pid: number) => { alive: boolean; identity?: string } }
const waitArray = new Int32Array(new SharedArrayBuffer(4)); let selfIdentity: string | undefined
const pause = (ms: number) => Atomics.wait(waitArray, 0, 0, ms)
function parse(text: string): Owner | undefined { try { const value = JSON.parse(text) as Owner; return value.version === 1 && typeof value.token === 'string' && Number.isInteger(value.pid) && typeof value.processIdentity === 'string' && (value.targetStaleToken === undefined || typeof value.targetStaleToken === 'string') ? value : undefined } catch { return undefined } }
function inspect(pid: number): { alive: boolean; identity?: string } {
  try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false }; return { alive: true } }
  try {
    if (process.platform === 'win32') { const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){$p.StartTime.ToUniversalTime().Ticks.ToString()}`], { encoding: 'utf8', windowsHide: true, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, PATH: process.env.PATH, TEMP: tmpdir(), TMP: tmpdir() } }).trim(); if (!value) { try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false } } }; return { alive: true, identity: value ? `win32:${value}` : undefined } }
    if (process.platform === 'linux') { const text = readFileSync(`/proc/${pid}/stat`, 'utf8'); const fields = text.slice(text.lastIndexOf(') ') + 2).split(' '); return { alive: true, identity: fields[19] ? `linux:${fields[19]}` : undefined } }
    const value = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim(); return { alive: true, identity: value ? `${process.platform}:${value}` : undefined }
  } catch {
    try { process.kill(pid, 0) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return { alive: false } }
    return { alive: true }
  }
}
selfIdentity = inspect(process.pid).identity
function ownerAt(path: string): Owner | undefined { try { return parse(readFileSync(path, 'utf8')) } catch { return undefined } }
function removeOwned(path: string, token: string, required: boolean, context: { deadline: number; backoffMs: number; inspectProcess: typeof inspect; self: { identity?: string } }): boolean {
  const owner = ownerAt(path); if (!owner) { if (required && existsSync(path)) throw new Error('Storage file lock has unknown owner'); return false } if (owner.token !== token) return false
  const claim = `${path}.claim-${token}`; const claimOwner: Owner = { version: 1, token: randomUUID(), pid: process.pid, processIdentity: context.self.identity!, createdAt: new Date().toISOString(), targetStaleToken: token }; let fd: number
  while (true) {
    try { fd = openSync(claim, 'wx'); writeFileSync(fd, JSON.stringify(claimOwner)); fsyncSync(fd); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = ownerAt(claim)
      if (!existing || existing.targetStaleToken !== token) { if (Date.now() >= context.deadline) throw new Error('Storage file lock cleanup claim has unknown owner'); pause(context.backoffMs); continue }
      const state = context.inspectProcess(existing.pid)
      if (!state.alive || (state.identity && state.identity !== existing.processIdentity)) { try { if (ownerAt(claim)?.token === existing.token) unlinkSync(claim) } catch (claimError) { if ((claimError as NodeJS.ErrnoException).code !== 'ENOENT') throw claimError }; continue }
      if (Date.now() >= context.deadline) throw new Error('Storage file lock cleanup claim acquisition timed out')
      pause(context.backoffMs)
    }
  }
  try {
    if (ownerAt(path)?.token !== token) return false
    try { unlinkSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    return true
  } finally {
    closeSync(fd!)
    while (true) { try { if (ownerAt(claim)?.token === claimOwner.token) unlinkSync(claim); break } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; if (Date.now() >= context.deadline) throw error; pause(context.backoffMs) } }
  }
}
export function acquireStorageFileLock(path: string, options: FileLockOptions = {}): () => void {
  const timeoutMs = options.timeoutMs ?? 500; const backoffMs = options.backoffMs ?? 20; const inspectProcess = options.inspectProcess ?? inspect; const deadline = Date.now() + timeoutMs
  const self = options.inspectProcess ? inspectProcess(process.pid) : (() => { if (!selfIdentity) selfIdentity = inspect(process.pid).identity; return { alive: true, identity: selfIdentity } })()
  if (!self.identity) throw new Error('Storage file lock process identity is unavailable')
  while (true) {
    let fd: number | undefined
    try { fd = openSync(path, 'wx') } catch (error) {
      const openCode = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(openCode ?? '')) { if (Date.now() >= deadline) throw new Error('Storage file lock acquisition timed out'); pause(backoffMs); continue }
      if (openCode !== 'EEXIST') throw error
      const owner = ownerAt(path)
      if (!owner) { if (Date.now() >= deadline) throw new Error('Storage file lock has unknown owner'); pause(backoffMs); continue }
      const state = inspectProcess(owner.pid)
      if (state.alive && !state.identity) throw new Error('Storage file lock process identity is unavailable; refusing stale recovery')
      if (!state.alive || state.identity !== owner.processIdentity) { removeOwned(path, owner.token, true, { deadline, backoffMs, inspectProcess, self }); continue }
      if (Date.now() >= deadline) throw new Error('Storage file lock acquisition timed out')
      pause(backoffMs); continue
    }
    const owner: Owner = { version: 1, token: randomUUID(), pid: process.pid, processIdentity: self.identity, createdAt: new Date().toISOString() }
    try { writeFileSync(fd, JSON.stringify(owner)); fsyncSync(fd) } catch (error) { closeSync(fd); try { unlinkSync(path) } catch { /* best effort */ } throw error }
    let released = false
    return () => { if (released) return; released = true; closeSync(fd!); removeOwned(path, owner.token, false, { deadline: Date.now() + timeoutMs, backoffMs, inspectProcess, self }) }
  }
}
