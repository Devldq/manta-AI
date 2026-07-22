import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createBackendStorageComposition, startServer, type MantaServerHandle } from '@manta/backend'
import { BootstrapStore, STORAGE_GROUP_IDS, volumeRoot } from '@manta/storage-hub'
import type { AshBootstrap, StorageVolumeRecord } from '@manta/shared'
import { startManagedQdrant } from './qdrant.js'

const execFileAsync = promisify(execFile)
const API_VERSION = 'v1'

export interface ServiceDescriptor {
  endpoint: string
  pid: number
  processIdentity: string
  instanceId: string
  apiVersion: typeof API_VERSION
  startedAt: string
}

export interface ServiceCredentials {
  version: 1
  tokens: {
    cli: { token: string; scopes: string[] }
    mcp: { token: string; scopes: string[] }
  }
}

export interface LocalServiceOptions {
  home?: string
  bootstrapPath?: string
  port?: number
  bundledSeedRoot?: string
  desktopNonces?: string[]
  startSchedulers?: boolean
  initializeExtensions?: boolean
  qdrantBinary?: string
  qdrantUrl?: string
  frontendDist?: string
}

export interface LocalServiceHandle {
  descriptor: ServiceDescriptor
  server: MantaServerHandle
  close(): Promise<void>
  waitUntilClosed(): Promise<void>
}

export function resolveMantaHome(env: NodeJS.ProcessEnv = process.env): string {
  return mantaHomeCandidates(env)[0]
}

export function mantaHomeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.MANTA_HOME) return [env.MANTA_HOME]
  const currentPlatform = platform()
  const unique = (values: string[]) => [...new Set(values)]
  if (currentPlatform === 'darwin') {
    const applicationSupport = join(homedir(), 'Library', 'Application Support')
    return unique([join(applicationSupport, 'Manta AI'), join(applicationSupport, 'Manta'), join(applicationSupport, 'Electron')])
  }
  if (currentPlatform === 'win32') {
    const appData = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return unique([join(appData, 'Manta AI'), join(appData, 'Manta')])
  }
  const state = env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  const config = env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return unique([join(state, 'manta-ai'), join(config, 'Manta'), join(config, 'manta-ai')])
}

export function serviceDescriptorPath(home = resolveMantaHome()): string { return join(home, 'service.json') }
export function serviceCredentialsPath(home = resolveMantaHome()): string { return join(home, 'credentials.json') }
export function serviceLogPath(home = resolveMantaHome()): string { return join(home, 'logs', 'service.log') }
export function serviceCliPath(): string {
  const moduleDirectory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  return join(moduleDirectory, 'cli.js')
}

export async function readServiceDescriptor(home = resolveMantaHome()): Promise<ServiceDescriptor | undefined> {
  try {
    const value = JSON.parse(await readFile(serviceDescriptorPath(home), 'utf8')) as ServiceDescriptor
    if (!value.endpoint || !value.pid || !value.processIdentity || !value.instanceId || value.apiVersion !== API_VERSION) return undefined
    return value
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}

export async function readServiceCredentials(home = resolveMantaHome()): Promise<ServiceCredentials | undefined> {
  try { return JSON.parse(await readFile(serviceCredentialsPath(home), 'utf8')) as ServiceCredentials }
  catch (error) { if (isMissing(error)) return undefined; throw error }
}

export async function isServiceDescriptorLive(descriptor: ServiceDescriptor): Promise<boolean> {
  const identity = await processIdentity(descriptor.pid).catch(() => undefined)
  if (identity !== descriptor.processIdentity) return false
  try {
    const response = await fetch(`${descriptor.endpoint}/v1/health`, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch { return false }
}

export async function startLocalService(options: LocalServiceOptions = {}): Promise<LocalServiceHandle> {
  const home = options.home ?? resolveMantaHome()
  await mkdir(home, { recursive: true, mode: 0o700 })
  await chmod(home, 0o700).catch(() => undefined)
  const processIdentityValue = await processIdentity(process.pid)
  const releaseLock = await acquireServiceLock(home, processIdentityValue)
  const instanceId = randomUUID()
  let server: MantaServerHandle | undefined
  let qdrant: Awaited<ReturnType<typeof startManagedQdrant>> | undefined
  try {
    const configuredFrontendDist = options.frontendDist ?? process.env.MANTA_FRONTEND_DIST
    const frontendDist = configuredFrontendDist ?? await resolveLocalFrontendDist()
    if (frontendDist) {
      try { await access(join(frontendDist, 'index.html')) }
      catch { throw Object.assign(new Error(`Frontend assets are missing: ${join(frontendDist, 'index.html')}`), { code: 'FRONTEND_ASSETS_MISSING' }) }
    }
    const credentials = await ensureServiceCredentials(home)
    const bootstrapPath = options.bootstrapPath ?? process.env.MANTA_BOOTSTRAP_PATH ?? join(home, 'ash-bootstrap.json')
    await ensureDefaultBootstrap(bootstrapPath, home)
    qdrant = await startManagedQdrant({ home, binary: options.qdrantBinary, url: options.qdrantUrl ?? process.env.QDRANT_URL })
    const bootstrapStore = new BootstrapStore(bootstrapPath)
    const composition = await createBackendStorageComposition(bootstrapStore)
    server = await startServer({
      storage: composition.runtime,
      port: options.port ?? 0,
      host: '127.0.0.1',
      startSchedulers: options.startSchedulers,
      startup: options.initializeExtensions === false ? false : undefined,
      bundledSeedRoot: options.bundledSeedRoot,
      storageApi: {
        readBootstrap: () => bootstrapStore.read(),
        inventory: composition.hub.inventory,
        capacityMetrics: composition.hub.capacityMetrics,
        listBackups: async () => [],
        agents: composition.agents.readModel,
        git: {
          capability: () => composition.git.capability(),
          bindings: () => composition.git.listBindings(),
          status: (volumeId: string) => composition.git.status(volumeId),
          history: (volumeId: string) => composition.git.history(volumeId),
        },
      },
      apiOnly: !frontendDist,
      frontendDist,
      isDev: false,
      logger: process.env.MANTA_TERMINAL_LOGS === '1',
      localAccess: {
        tokens: [credentials.tokens.cli, credentials.tokens.mcp],
        desktopNonces: options.desktopNonces,
      },
    })
    const descriptor: ServiceDescriptor = {
      endpoint: `http://127.0.0.1:${server.port}`,
      pid: process.pid,
      processIdentity: processIdentityValue,
      instanceId,
      apiVersion: API_VERSION,
      startedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(serviceDescriptorPath(home), descriptor, 0o600)
    let closed = false
    let closePromise: Promise<void> | undefined
    let resolveClosed!: () => void
    const didClose = new Promise<void>((resolve) => { resolveClosed = resolve })
    const close = () => closePromise ??= (async () => {
      if (closed) return
      closed = true
      const errors: unknown[] = []
      try { await server!.close() } catch (error) { errors.push(error) }
      try { await qdrant?.stop() } catch (error) { errors.push(error) }
      try {
        const current = await readServiceDescriptor(home)
        if (current?.instanceId === instanceId) await rm(serviceDescriptorPath(home), { force: true })
      } catch (error) { errors.push(error) }
      try { await releaseLock() } catch (error) { errors.push(error) }
      resolveClosed()
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'Manta Service shutdown was incomplete')
    })()
    return { descriptor, server, close, waitUntilClosed: () => didClose }
  } catch (error) {
    if (server) await server.close().catch(() => undefined)
    await qdrant?.stop().catch(() => undefined)
    await releaseLock().catch(() => undefined)
    throw error
  }
}

async function resolveLocalFrontendDist(): Promise<string | undefined> {
  const moduleDirectory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'frontend', 'dist')] : []),
    join(moduleDirectory, '..', '..', 'frontend', 'dist'),
  ]
  if (platform() === 'darwin') {
    for (const applications of ['/Applications', join(homedir(), 'Applications')]) {
      for (const name of ['Manta.app', 'Manta AI.app']) candidates.push(join(applications, name, 'Contents', 'Resources', 'frontend', 'dist'))
    }
  } else if (platform() === 'win32') {
    const roots = [process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined, process.env.ProgramFiles]
    for (const root of roots) if (root) for (const name of ['Manta', 'Manta AI']) candidates.push(join(root, name, 'resources', 'frontend', 'dist'))
  } else {
    if (process.env.APPDIR) candidates.push(join(process.env.APPDIR, 'usr', 'lib', 'manta', 'resources', 'frontend', 'dist'))
    candidates.push(join('/opt', 'Manta', 'resources', 'frontend', 'dist'), join('/usr', 'lib', 'manta', 'resources', 'frontend', 'dist'))
  }
  for (const candidate of [...new Set(candidates)]) {
    try { await access(join(candidate, 'index.html')); return candidate } catch { /* try the next trusted Desktop location */ }
  }
  return undefined
}

export async function processIdentity(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid process id')
  if (platform() === 'win32') {
    const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 2_000, windowsHide: true })
    return stdout.trim()
  }
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2_000 })
  const startedAt = stdout.trim()
  if (!startedAt) throw new Error(`Process ${pid} is not running`)
  return startedAt
}

async function acquireServiceLock(home: string, identity: string): Promise<() => Promise<void>> {
  const path = join(home, 'service.lock')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      const value = { pid: process.pid, processIdentity: identity, createdAt: new Date().toISOString() }
      await handle.writeFile(JSON.stringify(value), 'utf8')
      await handle.sync()
      await handle.close()
      let released = false
      return async () => {
        if (released) return
        released = true
        const current = await readLock(path)
        if (current?.pid === process.pid && current.processIdentity === identity) await rm(path, { force: true })
      }
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const current = await readLock(path)
      const liveIdentity = current ? await processIdentity(current.pid).catch(() => undefined) : undefined
      if (current && liveIdentity === current.processIdentity) throw Object.assign(new Error(`Manta Service is already running as PID ${current.pid}`), { code: 'SERVICE_ALREADY_RUNNING' })
      await rm(path, { force: true })
    }
  }
  throw Object.assign(new Error('Could not acquire the Manta Service lock'), { code: 'SERVICE_LOCK_FAILED' })
}

async function readLock(path: string): Promise<{ pid: number; processIdentity: string } | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as { pid: number; processIdentity: string } }
  catch (error) { if (isMissing(error) || error instanceof SyntaxError) return undefined; throw error }
}

async function ensureServiceCredentials(home: string): Promise<ServiceCredentials> {
  const current = await readServiceCredentials(home)
  if (current?.version === 1 && current.tokens?.cli?.token && current.tokens?.mcp?.token) return current
  const credentials: ServiceCredentials = {
    version: 1,
    tokens: {
      cli: { token: randomBytes(32).toString('base64url'), scopes: ['*'] },
      mcp: { token: randomBytes(32).toString('base64url'), scopes: ['knowledge:read', 'knowledge:write', 'jobs:read', 'jobs:write', 'skills:read', 'skills:run', 'agents:run'] },
    },
  }
  await writeJsonAtomic(serviceCredentialsPath(home), credentials, 0o600)
  return credentials
}

async function ensureDefaultBootstrap(bootstrapPath: string, home: string): Promise<AshBootstrap> {
  const store = new BootstrapStore(bootstrapPath)
  const existing = await store.read()
  if (existing) return existing
  const now = new Date().toISOString()
  const parentPath = join(home, 'local-storage')
  const volume: StorageVolumeRecord = { id: randomUUID(), name: 'Local', parentPath, createdAt: now, updatedAt: now }
  const root = volumeRoot(volume)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await Promise.all([...STORAGE_GROUP_IDS, '.ash-backups'].map((group) => mkdir(join(root, group), { recursive: true, mode: 0o700 })))
  const bootstrap: AshBootstrap = {
    schemaVersion: 1,
    generation: 1,
    volumes: [volume],
    groupAssignments: Object.fromEntries(STORAGE_GROUP_IDS.map((group) => [group, volume.id])) as AshBootstrap['groupAssignments'],
  }
  await writeJsonAtomic(join(root, 'ash-volume.json'), {
    schemaVersion: 1,
    volumeId: volume.id,
    name: volume.name,
    state: 'active',
    groups: STORAGE_GROUP_IDS,
    generation: 1,
    createdAt: now,
    updatedAt: now,
  }, 0o600)
  await mkdir(dirname(bootstrapPath), { recursive: true, mode: 0o700 })
  await store.write(bootstrap)
  return bootstrap
}

async function writeJsonAtomic(path: string, value: unknown, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode })
  await rename(temp, path)
  await chmod(path, mode).catch(() => undefined)
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') }
function isAlreadyExists(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') }

export async function assertPathExists(path: string): Promise<void> { await access(path) }
