import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { probeExistingQdrant } from './qdrant.js'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
})

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('probeExistingQdrant', () => {
  it('adopts a listening Qdrant that becomes healthy after the initial timeout', async () => {
    const url = await listen((_request, response) => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"result":{"collections":[]}}')
      }, 80)
    })

    await expect(probeExistingQdrant(url, {
      initialRequestTimeoutMs: 10,
      retryRequestTimeoutMs: 200,
      retryIntervalMs: 5,
      graceMs: 500,
      portTimeoutMs: 50,
    })).resolves.toBe('ready')
  })

  it('reports an occupied endpoint instead of allowing another instance to start', async () => {
    const url = await listen((_request, response) => {
      response.writeHead(503)
      response.end()
    })

    await expect(probeExistingQdrant(url, {
      initialRequestTimeoutMs: 20,
      retryRequestTimeoutMs: 20,
      retryIntervalMs: 5,
      graceMs: 50,
      portTimeoutMs: 50,
    })).resolves.toBe('occupied')
  })

  it('reports an endpoint with no listener as absent', async () => {
    const url = await listen((_request, response) => response.end())
    const server = servers.pop()!
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

    await expect(probeExistingQdrant(url, {
      initialRequestTimeoutMs: 20,
      portTimeoutMs: 20,
    })).resolves.toBe('absent')
  })
})
