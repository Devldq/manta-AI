import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { processIdentity } from '@manta/service'
import { stopLocalService } from './node'

const children = new Set<ChildProcess>()

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit').catch(() => undefined)
  }
  children.clear()
})

describe('local Service shutdown', () => {
  it('force-stops the same process when graceful shutdown times out', {
    skip: process.platform === 'win32',
  }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'manta-service-stop-'))
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    children.add(child)
    await once(child, 'spawn')
    if (!child.pid) throw new Error('Child process did not start')
    await once(child.stdout!, 'data')
    const identity = await processIdentity(child.pid)
    await writeFile(join(home, 'service.json'), JSON.stringify({
      endpoint: 'http://127.0.0.1:1',
      pid: child.pid,
      processIdentity: identity,
      instanceId: 'shutdown-regression',
      apiVersion: 'v1',
      startedAt: new Date().toISOString(),
    }))

    assert.equal(await stopLocalService(home, {
      gracefulTimeoutMs: 50,
      forceTimeoutMs: 2_000,
      pollIntervalMs: 10,
    }), true)
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
    assert.equal(child.signalCode, 'SIGKILL')
  })
})
