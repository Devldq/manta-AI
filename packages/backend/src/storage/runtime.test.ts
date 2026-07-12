import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StorageGroupId } from '@manta/shared'

const handles: Array<{ close(): Promise<void> }> = []
afterEach(async () => { await Promise.all(handles.splice(0).map((handle) => handle.close())) })

describe('backend lifecycle', () => {
  it('composes knowledge resources from routed ASH paths and can close them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-runtime-'))
    const { createBackendStorageRuntime } = await import('./runtime')
    const runtime = createBackendStorageRuntime({ resolve: (group, ...segments) => join(root, group, ...segments) })
    expect(runtime.drivers?.get('knowledge')).toBeDefined()
    expect((await runtime.healthCheck()).ok).toBe(true)
    await runtime.checkpoint()
    await runtime.close()
    expect((await runtime.healthCheck()).ok).toBe(false)
  })

  it('does not listen merely by importing the server module', async () => {
    const before = { sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') }
    await import('../server')
    expect(process.listenerCount('SIGINT')).toBe(before.sigint)
    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm)
  })

  it('returns the actual dynamic port and quiesces writes before closing resources', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-backend-'))
    const events: string[] = []
    let quiesced = false
    const storage = {
      resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
      async quiesce() { quiesced = true; events.push('quiesce') },
      async checkpoint() { events.push('checkpoint') },
      async close() { events.push('close') },
      async healthCheck() { return { ok: true as const } },
    }
    const { startServer } = await import('../server')
    const handle = await startServer({ storage, port: 0, startSchedulers: false, registerRoutes: false })
    handles.push(handle)
    expect(handle.port).toBeGreaterThan(0)
    expect((await handle.healthCheck()).ok).toBe(true)
    await handle.quiesce()
    expect(quiesced).toBe(true)
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/not-a-route`, { method: 'POST' })
    expect(response.status).toBe(503)
    await handle.close()
    handles.pop()
    expect(events).toEqual(['quiesce', 'checkpoint', 'close'])
  })

  it('attempts every shutdown stage even when an earlier stage fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-backend-failing-close-'))
    const events: string[] = []
    const storage = {
      resolve(group: StorageGroupId, ...segments: string[]) { return join(root, group, ...segments) },
      async quiesce() { events.push('quiesce'); throw new Error('quiesce failed') },
      async checkpoint() { events.push('checkpoint'); throw new Error('checkpoint failed') },
      async close() { events.push('close') },
      async healthCheck() { return { ok: true as const } },
    }
    const { startServer } = await import('../server')
    const handle = await startServer({ storage, port: 0, startSchedulers: false, registerRoutes: false })

    const closeError = await handle.close().catch((error: unknown) => error)
    expect(closeError).toBeInstanceOf(AggregateError)
    expect((closeError as AggregateError).errors.map(String).join('\n')).toMatch(/quiesce failed[\s\S]*checkpoint failed/)
    expect(events).toEqual(['quiesce', 'checkpoint', 'close'])
    await expect(fetch(`http://127.0.0.1:${handle.port}/api/health`)).rejects.toThrow()
  })
})
