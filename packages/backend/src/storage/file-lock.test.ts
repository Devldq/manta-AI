import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

  it('lets two barrier-synchronized child contenders recover one dead owner exactly once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-lock-race-')); const path = join(root, 'lock'); const barrier = join(root, 'go'); const critical = join(root, 'critical'); const results = join(root, 'results')
    writeFileSync(path, JSON.stringify({ version: 1, token: 'dead', pid: 2147483647, processIdentity: 'gone', createdAt: new Date().toISOString() }))
    const modulePath = pathToFileURL(join(process.cwd(), 'src', 'storage', 'file-lock.ts')).href
    const script = `import fs from 'node:fs';import {acquireStorageFileLock} from '${modulePath}';const [lock,barrier,critical,results,ready]=process.argv.slice(1);fs.writeFileSync(ready,'1');while(!fs.existsSync(barrier))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);const release=acquireStorageFileLock(lock,{timeoutMs:3000});let fd;try{fd=fs.openSync(critical,'wx');fs.appendFileSync(results,'enter\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,75)}catch(e){fs.appendFileSync(results,'overlap\\n');throw e}finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(critical)}release()}`
    const ready = [join(root, 'ready-1'), join(root, 'ready-2')]; const children = ready.map((marker) => spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script, path, barrier, critical, results, marker], { stdio: 'inherit' }))
    const until = Date.now() + 3000; while ((!ready.every(existsSync)) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5)); expect(ready.every(existsSync)).toBe(true); writeFileSync(barrier, 'go')
    const codes = await Promise.all(children.map((child) => new Promise<number | null>((resolve) => child.once('exit', resolve))))
    expect(codes).toEqual([0, 0]); expect(readFileSync(results, 'utf8').trim().split('\n')).toEqual(['enter', 'enter']); expect(existsSync(path)).toBe(false)
  })
})
