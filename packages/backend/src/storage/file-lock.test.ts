import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { acquireStorageFileLock } from './file-lock'

describe('storage file lock protocol', () => {
  it('recovers a dead owner and a reused PID identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-lock-dead-')); const path = join(root, 'lock')
    writeFileSync(path, JSON.stringify({ version: 1, token: 'dead', pid: 42, processIdentity: 'old', createdAt: new Date().toISOString() }))
    const release = acquireStorageFileLock(path, { inspectProcess: (pid) => pid === process.pid ? { alive: true, identity: 'self' } : { alive: true, identity: 'new' } }); release()
    expect(existsSync(path)).toBe(false)
  })

  it('an old release never removes a replacement lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-lock-token-')); const path = join(root, 'lock'); const release = acquireStorageFileLock(path, { inspectProcess: () => ({ alive: true, identity: 'self' }) })
    const replacement = { version: 1, token: 'replacement', pid: process.pid, processIdentity: 'self', createdAt: new Date().toISOString() }; writeFileSync(path, JSON.stringify(replacement)); release()
    expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('replacement')
  })

  it('fails closed for an unknown live owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-lock-unknown-')); const path = join(root, 'lock'); writeFileSync(path, '{}')
    expect(() => acquireStorageFileLock(path, { timeoutMs: 20, backoffMs: 5, inspectProcess: () => ({ alive: true, identity: 'self' }) })).toThrow(/unknown owner/i)
  })

  it('serializes two contenders after observing a stale lock', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-lock-wait-')); const path = join(root, 'lock')
    writeFileSync(path, JSON.stringify({ version: 1, token: 'dead', pid: 42, processIdentity: 'old', createdAt: new Date().toISOString() }))
    const clearStale = acquireStorageFileLock(path, { inspectProcess: (pid) => pid === process.pid ? { alive: true, identity: 'self' } : { alive: false } }); clearStale()
    const child = spawn(process.execPath, ['-e', `const fs=require('fs');const p=${JSON.stringify(path)};fs.writeFileSync(p,JSON.stringify({version:1,token:'child',pid:process.pid,processIdentity:'child',createdAt:new Date().toISOString()}));setTimeout(()=>fs.unlinkSync(p),200)`], { stdio: 'ignore' })
    const until = Date.now() + 1000; while (!existsSync(path) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5))
    const release = acquireStorageFileLock(path, { timeoutMs: 1000, inspectProcess: (pid) => pid === process.pid ? { alive: true, identity: 'self' } : { alive: true, identity: 'child' } }); release()
    await new Promise<void>((resolve) => child.once('exit', () => resolve())); expect(existsSync(path)).toBe(false)
  })
})
