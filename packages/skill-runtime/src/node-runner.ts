import { registerHooks } from 'node:module'

interface Envelope {
  source: string
  input: unknown
  resources: Record<string, string>
  manta?: { baseURL: string; apiKey: string }
  network: string[]
}

async function main(): Promise<void> {
  const envelope = JSON.parse(await readStdin()) as Envelope
  const originalError = console.error.bind(console)
  console.log = (...values: unknown[]) => originalError(...values)
  console.info = (...values: unknown[]) => originalError(...values)
  console.warn = (...values: unknown[]) => originalError(...values)
  const rawFetch = globalThis.fetch.bind(globalThis)
  const allowedHosts = new Set(envelope.network)
  if (envelope.manta) allowedHosts.add(new URL(envelope.manta.baseURL).host)
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!allowedHosts.has(url.host) && !allowedHosts.has(url.hostname)) throw new Error(`Network access denied for ${url.host}`)
    return rawFetch(input, init)
  }) as typeof fetch
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (isRawNetworkModule(specifier)) throw new Error(`Raw network module access is denied: ${specifier}; use fetch with an authorized host`)
      return nextResolve(specifier, context)
    },
  })
  const module = await import(`data:text/javascript;base64,${Buffer.from(envelope.source).toString('base64')}`)
  const execute = module.default ?? module.run
  if (typeof execute !== 'function') throw new Error('Node Skill entry must export a default function or named run function')
  const result = await execute({
    input: envelope.input,
    resources: envelope.resources,
    manta: envelope.manta ? createMantaClient(envelope.manta) : undefined,
  })
  process.stdout.write(JSON.stringify(result ?? null))
}

function isRawNetworkModule(specifier: string): boolean {
  const normalized = specifier.replace(/^node:/, '')
  return ['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises'].includes(normalized)
}

function createMantaClient(access: { baseURL: string; apiKey: string }) {
  const request = async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${access.baseURL}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        Authorization: `Bearer ${access.apiKey}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    const payload = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(`Manta API ${response.status}: ${JSON.stringify(payload)}`)
    return payload
  }
  return {
    request,
    knowledge: { search: (input: unknown) => request('/v1/knowledge/search', { method: 'POST', body: input }) },
    knowledgeBases: { list: () => request('/v1/knowledge-bases') },
    jobs: {
      retrieve: (id: string) => request(`/v1/jobs/${encodeURIComponent(id)}`),
      cancel: (id: string) => request(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    },
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
