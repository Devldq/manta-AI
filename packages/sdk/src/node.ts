import { open, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import {
  isServiceDescriptorLive,
  mantaHomeCandidates,
  processIdentity,
  readServiceCredentials,
  readServiceDescriptor,
  resolveMantaHome,
  serviceCliPath,
  serviceLogPath,
  type ServiceDescriptor,
} from '@manta/service'
import Manta, { type MantaClientOptions } from './index.js'

export interface LocalMantaOptions extends Omit<MantaClientOptions, 'baseURL' | 'apiKey'> {
  home?: string
  autoStart?: boolean
  startupTimeoutMs?: number
  tokenProfile?: 'cli' | 'mcp'
  environment?: NodeJS.ProcessEnv
}

export interface LocalServiceStatus {
  running: boolean
  descriptor?: ServiceDescriptor
}

export interface StopLocalServiceOptions {
  gracefulTimeoutMs?: number
  forceTimeoutMs?: number
  pollIntervalMs?: number
}

export async function createDesktopSessionURL(options: LocalMantaOptions = {}): Promise<string> {
  const home = options.home ?? await discoverLocalMantaHome(options.environment)
  const descriptor = await ensureLocalService({ home, autoStart: options.autoStart, startupTimeoutMs: options.startupTimeoutMs, environment: options.environment })
  const credentials = await readServiceCredentials(home)
  if (!credentials?.tokens.cli.token) throw new Error('Manta Desktop token is unavailable')
  const response = await fetch(`${descriptor.endpoint}/v1/desktop-nonces`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credentials.tokens.cli.token}` },
  })
  const body = await response.json() as { data?: { nonce?: string }; error?: { message?: string } }
  if (!response.ok || !body.data?.nonce) throw new Error(body.error?.message ?? 'Could not create a Manta Desktop session')
  return `${descriptor.endpoint}/v1/desktop-session?nonce=${encodeURIComponent(body.data.nonce)}`
}

export async function createLocalManta(options: LocalMantaOptions = {}): Promise<Manta> {
  const home = options.home ?? await discoverLocalMantaHome(options.environment)
  const descriptor = await ensureLocalService({ home, autoStart: options.autoStart, startupTimeoutMs: options.startupTimeoutMs, environment: options.environment })
  const credentials = await readServiceCredentials(home)
  const profile = options.tokenProfile ?? 'cli'
  const token = credentials?.tokens[profile]?.token
  if (!token) throw new Error(`Manta Service token profile ${profile} is unavailable`)
  return new Manta({ baseURL: descriptor.endpoint, apiKey: token, fetch: options.fetch, defaultHeaders: options.defaultHeaders })
}

export async function ensureLocalService(options: { home?: string; autoStart?: boolean; startupTimeoutMs?: number; environment?: NodeJS.ProcessEnv } = {}): Promise<ServiceDescriptor> {
  const home = options.home ?? await discoverLocalMantaHome(options.environment)
  const current = await readServiceDescriptor(home)
  if (current && await isServiceDescriptorLive(current)) return current
  if (options.autoStart === false) throw Object.assign(new Error('Manta Service is not running'), { code: 'SERVICE_NOT_RUNNING' })
  await mkdir(dirname(serviceLogPath(home)), { recursive: true })
  const log = await open(serviceLogPath(home), 'a', 0o600)
  const child = spawn(process.execPath, [serviceCliPath()], {
    detached: true,
    stdio: ['ignore', log.fd, log.fd],
    env: {
      ...process.env,
      ...(options.environment ?? {}),
      MANTA_HOME: home,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  })
  child.unref()
  await log.close()
  const deadline = Date.now() + Math.max(1_000, options.startupTimeoutMs ?? 20_000)
  while (Date.now() < deadline) {
    const descriptor = await readServiceDescriptor(home)
    if (descriptor && await isServiceDescriptorLive(descriptor)) return descriptor
    if (child.exitCode !== null) throw Object.assign(new Error(`Manta Service exited during startup with code ${child.exitCode}; see ${serviceLogPath(home)}`), { code: 'SERVICE_START_FAILED' })
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw Object.assign(new Error(`Manta Service did not become healthy; see ${serviceLogPath(home)}`), { code: 'SERVICE_START_TIMEOUT' })
}

export async function discoverLocalMantaHome(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates = mantaHomeCandidates(environment)
  for (const candidate of candidates) {
    const descriptor = await readServiceDescriptor(candidate)
    if (descriptor && await isServiceDescriptorLive(descriptor)) return candidate
  }
  const marked = await Promise.all(candidates.map(async (candidate) => {
    const credentials = await readServiceCredentials(candidate)
    if (!credentials) return undefined
    const bootstrap = await stat(join(candidate, 'ash-bootstrap.json')).catch(() => undefined)
    const marker = bootstrap ?? await stat(join(candidate, 'credentials.json')).catch(() => undefined)
    return marker ? { candidate, updatedAt: marker.mtimeMs } : undefined
  }))
  return marked.filter((value): value is { candidate: string; updatedAt: number } => Boolean(value))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.candidate ?? resolveMantaHome(environment)
}

export async function localServiceStatus(home?: string): Promise<LocalServiceStatus> {
  const resolvedHome = home ?? await discoverLocalMantaHome()
  const descriptor = await readServiceDescriptor(resolvedHome)
  return { running: Boolean(descriptor && await isServiceDescriptorLive(descriptor)), ...(descriptor ? { descriptor } : {}) }
}

export async function stopLocalService(home?: string, options: StopLocalServiceOptions = {}): Promise<boolean> {
  const resolvedHome = home ?? await discoverLocalMantaHome()
  const descriptor = await readServiceDescriptor(resolvedHome)
  if (!descriptor) return false
  const identity = await processIdentity(descriptor.pid).catch(() => undefined)
  if (identity !== descriptor.processIdentity) return false

  const waitForExit = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    do {
      const liveIdentity = await processIdentity(descriptor.pid).catch(() => undefined)
      if (liveIdentity !== descriptor.processIdentity) return true
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, options.pollIntervalMs ?? 100)))
    } while (true)
  }

  try { process.kill(descriptor.pid, 'SIGTERM') }
  catch (error) {
    if (await waitForExit(0)) return true
    throw error
  }
  if (await waitForExit(options.gracefulTimeoutMs ?? 10_000)) return true

  // A live SSE request can keep an older Service build inside server.close().
  // Re-check the process identity before escalating so a recycled PID can
  // never be killed by a stale descriptor.
  const liveIdentity = await processIdentity(descriptor.pid).catch(() => undefined)
  if (liveIdentity !== descriptor.processIdentity) return true
  process.kill(descriptor.pid, 'SIGKILL')
  if (await waitForExit(options.forceTimeoutMs ?? 2_000)) return true

  throw new Error(`Manta Service PID ${descriptor.pid} did not stop after SIGTERM and SIGKILL`)
}

export { Manta }
