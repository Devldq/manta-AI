import Fastify from 'fastify'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskRuntime } from '@manta/task-runtime'
import { approvalManager } from '../core/security/ApprovalManager'
import approvalRoutes from './approval'
import { createPendingApprovalSnapshot } from './approval-sse'
import { expirePendingApprovals } from './durable-approvals'
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
    expect(initial.json()).toMatchObject({
      success: true,
      policy: { mode: 'request', timeoutMs: 60_000, timeoutAction: 'deny' },
    })

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
    expect(full.json()).toMatchObject({
      success: true,
      policy: { mode: 'full', timeoutAction: 'approve' },
    })
    await app.close()
  })

  it('persists a bounded timeout while keeping legacy mode-only updates compatible', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-approval-timeout-'))
    const resolver = { resolve: (group: string, ...segments: string[]) => join(root, group, ...segments) }
    const app = await createApp(undefined, resolver)

    const configured = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'request', timeoutMs: 15_000 },
    })
    expect(configured.json()).toMatchObject({
      success: true,
      policy: { mode: 'request', timeoutMs: 15_000, timeoutAction: 'deny' },
    })

    const legacy = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'auto' },
    })
    expect(legacy.json()).toMatchObject({
      success: true,
      policy: { mode: 'auto', timeoutMs: 15_000, timeoutAction: 'deny' },
    })

    const invalid = await app.inject({
      method: 'PUT',
      url: '/api/approval/policy',
      payload: { mode: 'request', timeoutMs: 1_000 },
    })
    expect(invalid.statusCode).toBe(400)
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

  it('projects the server-owned deadline into reconnect snapshots', () => {
    const createdAt = Date.now()
    const requestId = approvalManager.createRequest(
      'shell',
      'conversation-deadline',
      undefined,
      'rm old.log',
      undefined,
      30_000,
      createdAt,
    )
    createdRequestIds.push(requestId)

    expect(createPendingApprovalSnapshot().requests).toContainEqual(expect.objectContaining({
      id: requestId,
      expiresAt: createdAt + 30_000,
      timeoutAction: 'deny',
    }))
  })

  it('feeds a timeout denial back into a durable waiting job', () => {
    const jobId = 'job-timeout'
    const requestId = `approval-${jobId}`
    const provideInput = vi.fn()
    const runtime = {
      getJob: (id: string) => id === jobId
        ? { id, kind: 'agent.run', status: 'waiting_for_input' }
        : undefined,
      provideInput,
    } as unknown as TaskRuntime
    approvalManager.createRequest('shell', jobId, undefined, 'rm old.log', requestId, 1, 1)
    createdRequestIds.push(requestId)

    expect(expirePendingApprovals(runtime, 2)).toBe(1)
    expect(provideInput).toHaveBeenCalledWith(jobId, {
      approvalId: requestId,
      decision: 'deny',
    })
    expect(approvalManager.getRequest(requestId)?.status).toBe('denied')
  })

  it('keeps an expired durable request pending until its runtime is available', () => {
    const jobId = 'job-timeout-no-runtime'
    const requestId = `approval-${jobId}`
    approvalManager.createRequest('write', jobId, '/outside/file.txt', undefined, requestId, 1, 1)
    createdRequestIds.push(requestId)

    expect(expirePendingApprovals(undefined, 2)).toBe(0)
    expect(approvalManager.getRequest(requestId)?.status).toBe('pending')
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
