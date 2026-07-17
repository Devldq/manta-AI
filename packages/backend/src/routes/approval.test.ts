import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { approvalManager } from '../core/security/ApprovalManager'
import approvalRoutes from './approval'
import { createPendingApprovalSnapshot } from './approval-sse'

const createdRequestIds: string[] = []

async function createApp() {
  const app = Fastify()
  await app.register(approvalRoutes)
  return app
}

afterEach(() => {
  for (const id of createdRequestIds.splice(0)) {
    const request = approvalManager.getRequest(id)
    if (request?.status === 'pending') approvalManager.respondToRequest(id, 'deny')
  }
})

describe('runtime approval routes', () => {
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
})
