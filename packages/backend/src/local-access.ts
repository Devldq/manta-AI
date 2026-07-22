import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

export interface LocalAccessToken {
  token: string
  scopes: string[]
}

export interface LocalAccessOptions {
  tokens: LocalAccessToken[]
  desktopNonces?: string[]
}

interface Session {
  scopes: string[]
}

const PUBLIC_PATHS = new Set(['/api/health', '/v1/health'])

export async function registerLocalAccess(app: FastifyInstance, options: LocalAccessOptions): Promise<void> {
  const nonces = new Map((options.desktopNonces ?? []).map((nonce) => [nonce, Number.POSITIVE_INFINITY]))
  const sessions = new Map<string, Session>()

  app.post('/v1/desktop-nonces', async () => {
    const nonce = randomUUID()
    nonces.set(nonce, Date.now() + 30_000)
    return { data: { nonce, expiresInMs: 30_000 } }
  })

  app.get('/v1/desktop-session', async (request, reply) => {
    assertLoopbackRequest(request)
    const nonce = typeof request.query === 'object' && request.query && 'nonce' in request.query ? String(request.query.nonce) : ''
    const expiresAt = nonces.get(nonce)
    nonces.delete(nonce)
    if (!nonce || expiresAt === undefined || expiresAt < Date.now()) return reply.status(401).send({ error: { code: 'INVALID_DESKTOP_NONCE', message: 'Desktop nonce is invalid, expired, or was already used' } })
    const sessionId = randomUUID()
    sessions.set(sessionId, { scopes: ['*'] })
    return reply.header('set-cookie', `manta_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`).redirect('/')
  })

  app.post('/v1/session', async (request, reply) => {
    assertLoopbackRequest(request)
    const nonce = typeof request.body === 'object' && request.body && 'nonce' in request.body ? String(request.body.nonce) : ''
    const expiresAt = nonces.get(nonce)
    nonces.delete(nonce)
    if (!nonce || expiresAt === undefined || expiresAt < Date.now()) return reply.status(401).send({ error: { code: 'INVALID_DESKTOP_NONCE', message: 'Desktop nonce is invalid, expired, or was already used' } })
    const sessionId = randomUUID()
    sessions.set(sessionId, { scopes: ['*'] })
    reply.header('set-cookie', `manta_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/`)
    return { data: { authenticated: true } }
  })

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/v1/session' || request.url.split('?')[0] === '/v1/desktop-session') return
    try {
      assertLoopbackRequest(request)
    } catch (error) {
      return reply.status(403).send({ error: { code: 'LOCAL_ACCESS_REQUIRED', message: error instanceof Error ? error.message : String(error) } })
    }
    if (PUBLIC_PATHS.has(request.url.split('?')[0] ?? '')) return
    const requiredScope = scopeFor(request)
    const sessionId = parseCookies(request.headers.cookie).manta_session
    const session = sessionId ? sessions.get(sessionId) : undefined
    const bearer = readBearer(request.headers.authorization)
    const token = bearer ? options.tokens.find((candidate) => secretEquals(candidate.token, bearer)) : undefined
    const scopes = session?.scopes ?? token?.scopes
    if (!scopes) return reply.status(401).send({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'A local Manta token is required' } })
    if (!scopes.includes('*') && !scopes.includes(requiredScope)) return reply.status(403).send({ error: { code: 'INSUFFICIENT_SCOPE', message: `Missing required scope: ${requiredScope}` } })
  })
}

function assertLoopbackRequest(request: FastifyRequest): void {
  const host = request.headers.host?.split(':')[0]?.replace(/^\[|\]$/g, '').toLowerCase()
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') throw new Error('Manta Service accepts loopback requests only')
  const origin = request.headers.origin
  if (!origin || origin === 'null') return
  let hostname: string
  try { hostname = new URL(origin).hostname.toLowerCase() } catch { throw new Error('Request Origin is invalid') }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)) throw new Error('Request Origin is not local')
}

function scopeFor(request: FastifyRequest): string {
  const path = request.url.split('?')[0] ?? ''
  if (path.startsWith('/v1/jobs')) return request.method === 'GET' ? 'jobs:read' : 'jobs:write'
  if (path.startsWith('/v1/upload-sessions')) return request.method === 'GET' ? 'knowledge:read' : 'knowledge:write'
  if (path.startsWith('/v1/knowledge-bases') || path.startsWith('/v1/knowledge')) return request.method === 'GET' || path.includes('/search') ? 'knowledge:read' : 'knowledge:write'
  if (path.includes('/search')) return 'knowledge:read'
  if (path.includes('/documents')) return request.method === 'GET' ? 'knowledge:read' : 'knowledge:write'
  if (path.startsWith('/v1/skills')) return request.method === 'GET' ? 'skills:read' : 'skills:run'
  if (path.startsWith('/v1/agent')) return 'agents:run'
  return request.method === 'GET' ? 'manta:read' : 'manta:write'
}

function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(value.split(';').map((part) => part.trim().split('=', 2)).filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0])))
}

function readBearer(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function secretEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
