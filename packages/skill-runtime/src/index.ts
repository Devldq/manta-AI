import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SkillManifestSchema, type JsonValue, type SkillManifest } from '@manta/contracts'
import { build as bundle } from 'esbuild'

export interface SkillAccess { baseURL: string; apiKey: string }
export interface SkillGrant { skillId: string; digest: string; permissions: string[]; authorizedAt: string }
export interface LoadedSkill {
  skillId: string
  directory: string
  digest: string
  prompt: string
  manifest?: SkillManifest
  requiredPermissions: string[]
  grant?: SkillGrant
  authorized: boolean
}
export interface SkillRunOptions {
  skillId: string
  directory: string
  input: JsonValue
  signal?: AbortSignal
  manta?: SkillAccess
}
export interface SkillRunResult {
  mode: 'prompt' | 'script'
  digest: string
  output: JsonValue
  durationMs: number
  stderr?: string
}

export class SkillRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly details?: JsonValue) {
    super(message)
    this.name = 'SkillRuntimeError'
  }
}

export class SkillRuntime {
  constructor(private readonly options: { grantsPath: string; maxOutputBytes?: number }) {}

  async inspect(skillId: string, directory: string): Promise<LoadedSkill> {
    const root = resolve(directory)
    const prompt = await readFile(join(root, 'SKILL.md'), 'utf8').catch((error) => {
      throw new SkillRuntimeError('SKILL_NOT_FOUND', `Skill ${skillId} does not contain SKILL.md: ${String(error)}`)
    })
    const digest = await digestDirectory(root)
    const manifest = await readManifest(root)
    const requiredPermissions = manifest ? permissionClaims(manifest) : []
    const grant = (await this.readGrants())[skillId]
    const authorized = !manifest || Boolean(grant && grant.digest === digest && requiredPermissions.every((claim) => grant.permissions.includes(claim)))
    return { skillId, directory: root, digest, prompt, manifest, requiredPermissions, grant, authorized }
  }

  async authorize(skillId: string, directory: string, permissions: string[]): Promise<SkillGrant> {
    const loaded = await this.inspect(skillId, directory)
    if (!loaded.manifest) throw new SkillRuntimeError('PROMPT_SKILL_NO_AUTHORIZATION_REQUIRED', 'Prompt-only Skills do not execute scripts')
    const requested = [...new Set(permissions)].sort()
    const undeclared = requested.filter((permission) => !loaded.requiredPermissions.includes(permission))
    if (undeclared.length) throw new SkillRuntimeError('SKILL_PERMISSION_UNDECLARED', `Skill did not declare: ${undeclared.join(', ')}`)
    const grant: SkillGrant = { skillId, digest: loaded.digest, permissions: requested, authorizedAt: new Date().toISOString() }
    const grants = await this.readGrants()
    grants[skillId] = grant
    await writeJsonAtomic(this.options.grantsPath, grants)
    return grant
  }

  async revoke(skillId: string): Promise<boolean> {
    const grants = await this.readGrants()
    if (!grants[skillId]) return false
    delete grants[skillId]
    await writeJsonAtomic(this.options.grantsPath, grants)
    return true
  }

  async run(options: SkillRunOptions): Promise<SkillRunResult> {
    options.signal?.throwIfAborted()
    const startedAt = Date.now()
    const loaded = await this.inspect(options.skillId, options.directory)
    options.signal?.throwIfAborted()
    if (!loaded.manifest) return { mode: 'prompt', digest: loaded.digest, output: { prompt: loaded.prompt }, durationMs: Date.now() - startedAt }
    if (!loaded.authorized) {
      throw new SkillRuntimeError('SKILL_AUTHORIZATION_REQUIRED', `Skill ${options.skillId} requires authorization for its current content digest`, { digest: loaded.digest, requiredPermissions: loaded.requiredPermissions })
    }
    if (loaded.manifest.permissions.manta.length && !options.manta) {
      throw new SkillRuntimeError('MANTA_ACCESS_UNAVAILABLE', 'This Skill requires scoped Manta SDK access')
    }
    const execution = await this.execute({ ...loaded, manifest: loaded.manifest }, options)
    return { mode: 'script', digest: loaded.digest, output: execution.output, durationMs: Date.now() - startedAt, ...(execution.stderr ? { stderr: execution.stderr } : {}) }
  }

  private async execute(loaded: LoadedSkill & { manifest: SkillManifest }, options: SkillRunOptions): Promise<{ output: JsonValue; stderr: string }> {
    const manifest = loaded.manifest
    const entry = inside(loaded.directory, manifest.entry, 'entry')
    const resources = Object.fromEntries(manifest.resources.map((resource) => [resource, inside(loaded.directory, resource, 'resource')]))
    const source = manifest.runtime === 'node' ? await bundleNodeEntry(entry) : undefined
    options.signal?.throwIfAborted()
    const envelope = JSON.stringify({ source, entry, input: options.input, resources, manta: options.manta, network: manifest.permissions.network })
    const moduleDirectory = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
    const runnerPath = join(moduleDirectory, 'node-runner.js')
    const runnerSource = manifest.runtime === 'node' ? await readFile(runnerPath, 'utf8') : undefined
    const command = manifest.runtime === 'node' ? process.execPath : manifest.executable!
    const args = manifest.runtime === 'node'
      ? nodeArguments(runnerSource!, loaded.directory, manifest, Object.values(resources))
      : [...manifest.args, entry]
    const child = spawn(command, args, {
      cwd: loaded.directory,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnvironment(manifest, options.manta),
    })
    child.stdin.end(envelope)
    const maxBytes = this.options.maxOutputBytes ?? 1024 * 1024
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) void terminateTree(child)
      else target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    const abort = () => void terminateTree(child)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) void terminateTree(child)
    const timeout = setTimeout(() => void terminateTree(child), manifest.timeoutMs)
    timeout.unref()
    const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolveExit({ code, signal }))
    }).finally(() => {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abort)
    })
    if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Skill execution cancelled')
    if (bytes > maxBytes) throw new SkillRuntimeError('SKILL_OUTPUT_LIMIT', `Skill output exceeded ${maxBytes} bytes`)
    const errorText = Buffer.concat(stderr).toString('utf8').trim()
    if (code !== 0) throw new SkillRuntimeError('SKILL_PROCESS_FAILED', `Skill process exited with ${code ?? signal ?? 'unknown'}${errorText ? `: ${errorText}` : ''}`)
    const text = Buffer.concat(stdout).toString('utf8').trim()
    try { return { output: JSON.parse(text || 'null') as JsonValue, stderr: errorText } }
    catch { throw new SkillRuntimeError('SKILL_PROTOCOL_ERROR', 'Skill stdout must contain exactly one JSON value', { stdout: text.slice(0, 1_000), stderr: errorText.slice(0, 1_000) }) }
  }

  private async readGrants(): Promise<Record<string, SkillGrant>> {
    try { return JSON.parse(await readFile(this.options.grantsPath, 'utf8')) as Record<string, SkillGrant> }
    catch (error) { if (isMissing(error) || error instanceof SyntaxError) return {}; throw error }
  }
}

function permissionClaims(manifest: SkillManifest): string[] {
  const claims = [
    ...manifest.permissions.manta.map((scope) => `manta:${scope}`),
    ...manifest.permissions.files.read.map((path) => `files:read:${path}`),
    ...manifest.permissions.files.write.map((path) => `files:write:${path}`),
    ...manifest.permissions.network.map((host) => `network:${host}`),
    ...manifest.permissions.environment.map((name) => `env:${name}`),
    ...(manifest.permissions.subprocess ? ['subprocess'] : []),
  ]
  return [...new Set(claims)].sort()
}

async function readManifest(root: string): Promise<SkillManifest | undefined> {
  try { return SkillManifestSchema.parse(JSON.parse(await readFile(join(root, 'manta.skill.json'), 'utf8'))) }
  catch (error) { if (isMissing(error)) return undefined; throw new SkillRuntimeError('INVALID_SKILL_MANIFEST', error instanceof Error ? error.message : String(error)) }
}

function inside(root: string, value: string, label: string): string {
  if (isAbsolute(value)) throw new SkillRuntimeError('INVALID_SKILL_PATH', `${label} must be relative to the Skill directory`)
  const target = resolve(root, value)
  const rel = relative(resolve(root), target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new SkillRuntimeError('INVALID_SKILL_PATH', `${label} resolves outside the Skill directory`)
  return target
}

function nodeArguments(runnerSource: string, skillDirectory: string, manifest: SkillManifest, resources: string[]): string[] {
  const readPaths = [...resources, ...manifest.permissions.files.read.map((path) => resolvePermissionPath(skillDirectory, path))]
  const writePaths = manifest.permissions.files.write.map((path) => resolvePermissionPath(skillDirectory, path))
  const args = ['--experimental-permission', ...[...new Set(readPaths)].map((path) => `--allow-fs-read=${path}`)]
  for (const path of new Set(writePaths)) args.push(`--allow-fs-write=${path}`)
  if (manifest.permissions.subprocess) args.push('--allow-child-process')
  return [...args, '--input-type=module', '--eval', runnerSource]
}

function resolvePermissionPath(root: string, path: string): string { return isAbsolute(path) ? path : resolve(root, path) }

async function bundleNodeEntry(entry: string): Promise<string> {
  const result = await bundle({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  })
  const output = result.outputFiles[0]?.text
  if (!output) throw new SkillRuntimeError('SKILL_BUNDLE_FAILED', 'Skill entry produced no executable output')
  return output
}

function childEnvironment(manifest: SkillManifest, manta?: SkillAccess): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of manifest.permissions.environment) if (process.env[name] !== undefined) env[name] = process.env[name]
  env.MANTA_SKILL_RUNTIME = manifest.runtime
  if (process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1') env.ELECTRON_RUN_AS_NODE = '1'
  if (manta) env.MANTA_BASE_URL = manta.baseURL
  return env
}

async function digestDirectory(root: string): Promise<string> {
  const hash = createHash('sha256')
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const rel = relative(root, path).split(sep).join('/')
      if (entry.isSymbolicLink()) throw new SkillRuntimeError('SKILL_SYMLINK_REJECTED', `Skill packages cannot contain symbolic links: ${rel}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) { hash.update(rel); hash.update('\0'); hash.update(await readFile(path)); hash.update('\0') }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  await rename(temp, path)
}

async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, shell: false })
    await new Promise((resolveExit) => killer.once('close', resolveExit))
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT') }
