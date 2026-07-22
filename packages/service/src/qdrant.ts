import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ManagedQdrant {
  url: string
  owned: boolean
  stop(): Promise<void>
}

export interface ManagedQdrantOptions {
  home: string
  binary?: string
  url?: string
}

export async function startManagedQdrant(options: ManagedQdrantOptions): Promise<ManagedQdrant> {
  const configuredUrl = options.url?.replace(/\/$/, '')
  if (configuredUrl) {
    if (!await qdrantReady(configuredUrl)) throw Object.assign(new Error(`Configured Qdrant is unavailable: ${configuredUrl}`), { code: 'QDRANT_EXTERNAL_UNAVAILABLE' })
    exposeQdrantUrl(configuredUrl)
    return { url: configuredUrl, owned: false, async stop() {} }
  }
  const url = 'http://127.0.0.1:6333'
  if (await qdrantReady(url)) {
    exposeQdrantUrl(url)
    return { url, owned: false, async stop() {} }
  }
  const configuredBinary = options.binary ?? process.env.MANTA_QDRANT_BINARY
  const binary = configuredBinary ?? await resolveLocalQdrantBinary()
  try { await access(binary) } catch { throw Object.assign(new Error(`Local Qdrant binary is missing: ${binary}`), { code: 'QDRANT_BINARY_MISSING' }) }
  const root = join(options.home, 'qdrant')
  const storage = join(root, 'storage')
  const snapshots = join(root, 'snapshots')
  await Promise.all([mkdir(storage, { recursive: true }), mkdir(snapshots, { recursive: true })])
  const child = spawn(binary, [], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      QDRANT__SERVICE__HOST: '127.0.0.1',
      QDRANT__SERVICE__HTTP_PORT: '6333',
      QDRANT__SERVICE__GRPC_PORT: '6334',
      QDRANT__STORAGE__STORAGE_PATH: storage,
      QDRANT__STORAGE__SNAPSHOTS_PATH: snapshots,
      QDRANT__TELEMETRY_DISABLED: 'true',
    },
  })
  let output = ''
  let didExit = false
  let spawnError: Error | undefined
  const append = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-8_000) }
  child.stdout?.on('data', (chunk: Buffer) => { append(chunk); if (process.env.MANTA_TERMINAL_LOGS === '1') process.stdout.write(chunk) })
  child.stderr?.on('data', (chunk: Buffer) => { append(chunk); if (process.env.MANTA_TERMINAL_LOGS === '1') process.stderr.write(chunk) })
  child.once('error', (error) => { spawnError = error })
  const exitPromise = new Promise<void>((resolve) => child.once('close', () => { didExit = true; resolve() }))
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await qdrantReady(url)) {
      exposeQdrantUrl(url)
      return { url, owned: true, stop: () => stopChild(child, () => didExit, exitPromise) }
    }
    if (spawnError || didExit) break
    await delay(100)
  }
  await stopChild(child, () => didExit, exitPromise)
  throw Object.assign(new Error(`Local Qdrant failed to start: ${spawnError?.message || output.trim() || 'startup timeout'}`), { code: 'QDRANT_START_FAILED' })
}

export async function resolveLocalQdrantBinary(): Promise<string> {
  const candidates = localQdrantBinaryCandidates()
  const invalid: string[] = []
  for (const candidate of candidates) {
    try { await access(candidate) } catch { continue }
    try {
      await verifyBundledQdrant(candidate)
      return candidate
    } catch (error) {
      invalid.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (invalid.length) throw Object.assign(new Error(`Bundled Qdrant validation failed:\n${invalid.join('\n')}`), { code: 'QDRANT_BINARY_INVALID' })
  throw Object.assign(new Error(`Local Qdrant binary is missing. Checked:\n${candidates.join('\n')}`), { code: 'QDRANT_BINARY_MISSING' })
}

function localQdrantBinaryCandidates(): string[] {
  const executable = process.platform === 'win32' ? 'qdrant.exe' : 'qdrant'
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform
  const moduleDirectory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'qdrant', executable)] : []),
    join(moduleDirectory, '..', '..', 'desktop', '.qdrant', `${os}-${process.arch}`, executable),
  ]
  if (process.platform === 'darwin') {
    for (const applications of ['/Applications', join(homedir(), 'Applications')]) {
      for (const name of ['Manta.app', 'Manta AI.app']) candidates.push(join(applications, name, 'Contents', 'Resources', 'qdrant', executable))
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined, process.env.ProgramFiles]
    for (const root of roots) if (root) for (const name of ['Manta', 'Manta AI']) candidates.push(join(root, name, 'resources', 'qdrant', executable))
  } else {
    if (process.env.APPDIR) candidates.push(join(process.env.APPDIR, 'usr', 'lib', 'manta', 'resources', 'qdrant', executable))
    candidates.push(join('/opt', 'Manta', 'resources', 'qdrant', executable), join('/usr', 'lib', 'manta', 'resources', 'qdrant', executable))
  }
  return [...new Set(candidates)]
}

async function verifyBundledQdrant(binary: string): Promise<void> {
  const manifestPath = join(dirname(binary), 'qdrant-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { schemaVersion?: unknown; executableSha256?: unknown }
  if (manifest.schemaVersion !== 1 || typeof manifest.executableSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.executableSha256)) {
    throw new Error(`Invalid Qdrant manifest: ${manifestPath}`)
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(binary)) digest.update(chunk)
  const actual = digest.digest('hex')
  if (actual !== manifest.executableSha256) throw new Error(`Qdrant executable hash mismatch: expected ${manifest.executableSha256}, received ${actual}`)
}

async function qdrantReady(url: string): Promise<boolean> {
  return new Promise((resolveReady) => {
    const target = new URL(`${url}/collections`)
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'GET',
      agent: false,
      headers: { Connection: 'close' },
    })
    let settled = false
    const settle = (ready: boolean) => {
      if (settled) return
      settled = true
      resolveReady(ready)
    }
    request.setTimeout(750, () => request.destroy(new Error('Qdrant readiness timeout')))
    request.once('error', () => settle(false))
    request.once('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 64 * 1024) request.destroy(new Error('Qdrant readiness response is too large'))
        else chunks.push(chunk)
      })
      response.once('error', () => settle(false))
      response.once('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) return settle(false)
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: { collections?: unknown[] } }
          settle(Array.isArray(body.result?.collections))
        } catch { settle(false) }
      })
    })
    request.end()
  })
}

function exposeQdrantUrl(url: string): void { process.env.QDRANT_URL = url }
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function stopChild(child: ChildProcess, exited: () => boolean, exitPromise: Promise<void>): Promise<void> {
  if (exited()) return
  child.kill('SIGTERM')
  await Promise.race([exitPromise, delay(5_000)])
  if (!exited()) { child.kill('SIGKILL'); await Promise.race([exitPromise, delay(1_000)]) }
}
