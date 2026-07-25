import Fastify from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskRuntime } from '@manta/task-runtime'
import { approvalManager } from '../core/security/ApprovalManager'
import approvalRoutes from './approval'
import { createPendingApprovalSnapshot } from './approval-sse'
import { runWithStorageResolver, type StoragePathResolver } from '../storage/path-routing'

const createdRequestIds: string[] = []

async function createApp(taskRuntime?: TaskRuntime, storageResolver?: StoragePathResolver) {
  const app = Fastify()
  app.decorate('taskRuntime', taskRuntime)
  if (storageResolver) {
    app.addHook('onRequest', (_request, _reply, done) => {
      runWithStorageResolver(storageResolver, done)
    })
  }
  await app.register(approvalRoutes)
  return app
}

afterEach(() => {
  for (const id of createdRequestIds.splice(0)) {
    approvalManager.discardRequest(id)
  }
})

describe('runtime approval routes', () => {
  it('defaults to request approval and requires explicit confirmation for full access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-approval-policy-'))
    const resolver = { resolve: (group: string, ...segments: string[]) => join(root, group, ...segments) }
    const app = await createApp(undefined, resolver)

    const initial = await app.inject('/api/approval/policy')
    expect(initial.json()).toMatchObject({ success: true, policy: { mode: 'request' } })

    const unconfirmed = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'full' },
    })
    expect(unconfirmed.statusCode).toBe(400)
    expect(unconfirmed.json()).toMatchObject({ code: 'FULL_ACCESS_CONFIRMATION_REQUIRED' })

    const auto = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'auto' },
    })
    expect(auto.json()).toMatchObject({ success: true, policy: { mode: 'auto' } })

    const full = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'full', confirmFullAccess: true },
    })
    expect(full.json()).toMatchObject({ success: true, policy: { mode: 'full' } })
    await app.close()
  })

  it('builds an authoritative reconnect snapshot from manager state', () => {
    const requestId = approvalManager.createRequest('read', 'conversation-snapshot', '/outside/snapshot.txt')
    createdRequestIds.push(requestId)

    expect(createPendingApprovalSnapshot()).toEqual(expect.objectContaining({
      type: 'approval-snapshot',
      requests: expect.arrayContaining([
        expect.objectContaining({ id: requestId, requestedBy: 'conversation-snapshot' }),
      ]),
    }))
  })

  it('lists requests created by the manager used by runtime tools', async () => {
    const app = await createApp()
    const requestId = approvalManager.createRequest('read', 'conversation-a', '/outside/file.txt')
    createdRequestIds.push(requestId)

    const response = await app.inject('/api/approval/pending')

    expect(response.statusCode).toBe(200)
    expect(response.json().requests).toContainEqual(expect.objectContaining({
      id: requestId,
      type: 'read',
      requestedBy: 'conversation-a',
      path: '/outside/file.txt',
    }))
    await app.close()
  })

  it('resolves the manager waiter when the REST decision is submitted', async () => {
    const app = await createApp()
    const requestId = approvalManager.createRequest('shell', 'conversation-b', undefined, 'echo safe')
    createdRequestIds.push(requestId)
    const waiting = approvalManager.waitForResponse(requestId, 1_000)

    const response = await app.inject({
      method: 'POST',
      url: `/api/approval/${requestId}/respond`,
      payload: { action: 'approve' },
    })

    expect(response.statusCode).toBe(200)
    await expect(waiting).resolves.toBe(true)
    await app.close()
  })

  it('rejects an unsupported decision instead of treating it as a denial', async () => {
    const app = await createApp()
    const requestId = approvalManager.createRequest('write', 'conversation-c', '/outside/file.txt')
    createdRequestIds.push(requestId)

    const response = await app.inject({
      method: 'POST',
      url: `/api/approval/${requestId}/respond`,
      payload: { action: 'later' },
    })

    expect(response.statusCode).toBe(400)
    expect(approvalManager.getRequest(requestId)?.status).toBe('pending')
    await app.close()
  })

  it('expires an unanswered in-process request when its waiter times out', async () => {
    const requestId = approvalManager.createRequest('read', 'conversation-timeout', '/outside/slow.txt')
    createdRequestIds.push(requestId)

    await expect(approvalManager.waitForResponse(requestId, 1)).resolves.toBe(false)

    expect(approvalManager.getRequest(requestId)?.status).toBe('denied')
    expect(createPendingApprovalSnapshot().requests).not.toContainEqual(
      expect.objectContaining({ id: requestId }),
    )
  })

  it('treats a late response to a cancelled durable approval as an idempotent stale response', async () => {
    const jobId = 'job-cancelled'
    const requestId = `approval-${jobId}`
    const runtime = {
      listJobs: () => [],
      getJob: (id: string) => id === jobId ? { id, kind: 'agent.run', status: 'cancelled' } : undefined,
      events: () => [],
    } as unknown as TaskRuntime
    const app = await createApp(runtime)
    approvalManager.createRequest('shell', jobId, undefined, 'echo stale', requestId)
    createdRequestIds.push(requestId)

    const response = await app.inject({
      method: 'POST',
      url: `/api/approval/${requestId}/respond`,
      payload: { action: 'approve' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ success: true, stale: true })
    expect(approvalManager.getRequest(requestId)?.status).toBe('denied')
    await app.close()
  })
})
