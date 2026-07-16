import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { AdapterRegistry, AssetManifestStore, CodexAdapter, ProjectionCoordinator, VolumeObjectStore, type AdapterJournalPhase, type AdapterPlan, type AdapterResult, type AgentInstallation, type CodexPortableAsset, type CodexPortableAssetKind, type CodexPortableAssetRepository, type CodexPortableAssetSummary, type CodexSecretRepository, type PreviewFileOperation } from '@manta/storage-hub'
import type { StorageGroupId } from '@manta/shared'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const DESCRIPTOR_SUFFIX = '.json'

interface PortableAssetDescriptor {
  schemaVersion: 1
  id: string
  kind: CodexPortableAssetKind
  name: string
  files?: Array<{ relativePath: string; hash: string; size: number }>
  metadata?: Readonly<Record<string, unknown>>
  secretReferenceIds?: readonly string[]
  digest: string
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}
function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
function assertId(value: string, label: string): void { if (!SAFE_ID.test(value)) throw new Error(`${label} is invalid`) }
function safeRelative(value: string): boolean { return value.length > 0 && !value.includes('\0') && !/^[\\/]|^[A-Za-z]:[\\/]/.test(value) && value.split(/[\\/]/).every((part) => !!part && part !== '.' && part !== '..') }
function jsonMetadata(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Portable asset metadata is not JSON serializable')
  const parsed: unknown = JSON.parse(serialized)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Portable asset metadata must be an object')
  return parsed as Readonly<Record<string, unknown>>
}

export interface AgentStorageIoHooks {
  afterAncestorSnapshot?(operation: 'descriptor-read' | 'descriptor-write' | 'secret-write', path: string): Promise<void>
  afterLeafOpen?(operation: 'descriptor-write' | 'secret-write', path: string): Promise<void>
}
interface DirectoryIdentity { path: string; identity: string }
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0
function statIdentity(value: { dev: number | bigint; ino: number | bigint; birthtimeNs?: bigint }): string { return `${value.dev}:${value.ino}:${value.birthtimeNs ?? ''}` }
function canonicalSystemAncestorPath(path: string): string {
  const absolute = resolve(path)
  // macOS exposes /var and /tmp as root-owned compatibility aliases below /private.
  // Fold only those exact system prefixes; realpath(path) would also trust attacker-controlled links below the storage root.
  if (process.platform === 'darwin') {
    for (const alias of ['/var', '/tmp']) if (absolute === alias || absolute.startsWith(`${alias}/`)) return `/private${absolute}`
  }
  return absolute
}
function ancestorPaths(path: string): string[] { const absolute = canonicalSystemAncestorPath(path); const root = parse(absolute).root; const relative = absolute.slice(root.length).split(/[\\/]/).filter(Boolean); const paths = [root]; for (const part of relative) paths.push(join(paths.at(-1)!, part)); return paths }
async function snapshotDirectoryChain(path: string): Promise<readonly DirectoryIdentity[]> {
  const result: DirectoryIdentity[] = []
  for (const current of ancestorPaths(path)) { const value = await lstat(current, { bigint: true }); if (!value.isDirectory() || value.isSymbolicLink()) throw new Error(`Storage ancestor is linked or not an ordinary directory: ${current}`); result.push({ path: current, identity: statIdentity(value) }) }
  return result
}
async function assertDirectoryChain(snapshot: readonly DirectoryIdentity[]): Promise<void> {
  for (const expected of snapshot) { const value = await lstat(expected.path, { bigint: true }); if (!value.isDirectory() || value.isSymbolicLink() || statIdentity(value) !== expected.identity) throw new Error(`Storage ancestor identity changed: ${expected.path}`) }
}
async function ensureOrdinaryDirectory(parent: string, directory: string, mode?: number): Promise<void> {
  const before = await snapshotDirectoryChain(parent)
  try { await mkdir(directory, { mode }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertDirectoryChain(before)
  const value = await lstat(directory, { bigint: true }); if (!value.isDirectory() || value.isSymbolicLink()) throw new Error('Storage directory is linked or not an ordinary directory')
  if (mode !== undefined && process.platform !== 'win32') { await chmod(directory, mode); const secured = await lstat(directory); if ((secured.mode & 0o777) !== mode) throw new Error('Storage directory permissions are not private') }
}
async function ensureOrdinaryChildDirectory(parent: string, directory: string): Promise<void> {
  if (resolve(dirname(directory)) !== resolve(parent)) throw new Error('Codex directory must be a direct child of its verified parent')
  const before = await lstat(parent, { bigint: true })
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Codex directory parent is linked or not an ordinary directory')
  try { await mkdir(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const after = await lstat(parent, { bigint: true })
  if (!after.isDirectory() || after.isSymbolicLink() || statIdentity(after) !== statIdentity(before)) throw new Error('Codex directory parent identity changed')
  const created = await lstat(directory)
  if (!created.isDirectory() || created.isSymbolicLink()) throw new Error('Codex directory is linked or not an ordinary directory')
}
async function readOrdinaryNoFollow(path: string, operation: 'descriptor-read', hooks?: AgentStorageIoHooks): Promise<string> {
  const ancestors = await snapshotDirectoryChain(dirname(path)); await hooks?.afterAncestorSnapshot?.(operation, path); await assertDirectoryChain(ancestors)
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW)
  try {
    const opened = await handle.stat({ bigint: true }); if (!opened.isFile()) throw new Error('Storage leaf is not an ordinary file')
    const bytes = await handle.readFile(); const leaf = await lstat(path, { bigint: true }); if (!leaf.isFile() || leaf.isSymbolicLink() || statIdentity(leaf) !== statIdentity(opened)) throw new Error('Storage leaf identity changed')
    await assertDirectoryChain(ancestors); return bytes.toString('utf8')
  } finally { await handle.close() }
}
async function readDirectoryNamesStable(path: string, hooks?: AgentStorageIoHooks): Promise<string[]> {
  const ancestors = await snapshotDirectoryChain(path); await hooks?.afterAncestorSnapshot?.('descriptor-read', path); await assertDirectoryChain(ancestors)
  const names = await readdir(path); await assertDirectoryChain(ancestors); return names
}
async function writeExclusiveDurable(path: string, bytes: string, mode = 0o600, operation: 'descriptor-write' | 'secret-write' = 'descriptor-write', hooks?: AgentStorageIoHooks): Promise<void> {
  const ancestors = await snapshotDirectoryChain(dirname(path)); await hooks?.afterAncestorSnapshot?.(operation, path); await assertDirectoryChain(ancestors)
  const parent = await open(dirname(path), constants.O_RDONLY | NO_FOLLOW)
  try {
    const openedParent = await parent.stat({ bigint: true }); if (!openedParent.isDirectory() || statIdentity(openedParent) !== ancestors.at(-1)?.identity) throw new Error('Storage parent identity changed')
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, mode)
    try {
      const opened = await handle.stat({ bigint: true }); if (!opened.isFile() || opened.size !== 0n) throw new Error('Storage leaf is not a new empty ordinary file')
      await hooks?.afterLeafOpen?.(operation, path)
      await assertDirectoryChain(ancestors); const parentBeforeWrite = await parent.stat({ bigint: true }); if (statIdentity(parentBeforeWrite) !== statIdentity(openedParent)) throw new Error('Storage parent identity changed before write'); const leafBeforeWrite = await lstat(path, { bigint: true }); if (!leafBeforeWrite.isFile() || leafBeforeWrite.isSymbolicLink() || statIdentity(leafBeforeWrite) !== statIdentity(opened)) throw new Error('Storage leaf identity changed before write')
      await handle.writeFile(bytes, 'utf8'); await handle.sync()
      const leaf = await lstat(path, { bigint: true }); if (!leaf.isFile() || leaf.isSymbolicLink() || statIdentity(leaf) !== statIdentity(opened)) throw new Error('Storage leaf identity changed'); await assertDirectoryChain(ancestors); const parentAfterWrite = await parent.stat({ bigint: true }); if (statIdentity(parentAfterWrite) !== statIdentity(openedParent)) throw new Error('Storage parent identity changed after write')
    } finally { await handle.close() }
    try { await parent.sync() } catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error }
  } finally { await parent.close() }
}

/** Immutable Codex assets whose bytes are backed by the extensions volume's verified CAS. */
export class AshCodexPortableAssetRepository implements CodexPortableAssetRepository {
  readonly #extensionsRoot: string
  readonly #volumeRoot: string
  readonly #objects: VolumeObjectStore
  readonly #manifests: AssetManifestStore
  readonly #hooks?: AgentStorageIoHooks

  constructor(extensionsRoot: string, hooks?: AgentStorageIoHooks) {
    this.#extensionsRoot = resolve(extensionsRoot); this.#volumeRoot = dirname(this.#extensionsRoot)
    this.#objects = new VolumeObjectStore(this.#volumeRoot); this.#manifests = new AssetManifestStore(this.#volumeRoot)
    this.#hooks = hooks
  }

  #descriptorPath(id: string): string { assertId(id, 'Portable asset id'); return join(this.#extensionsRoot, 'agent-assets', `${id}${DESCRIPTOR_SUFFIX}`) }
  #manifestId(id: string): string { return `codex-${createHash('sha256').update(id).digest('hex')}` }

  async #readDescriptor(id: string): Promise<unknown> { const path = this.#descriptorPath(id); return JSON.parse(await readOrdinaryNoFollow(path, 'descriptor-read', this.#hooks)) }

  async list(): Promise<readonly CodexPortableAssetSummary[]> {
    const directory = join(this.#extensionsRoot, 'agent-assets')
    let names: string[]
    try { names = await readDirectoryNamesStable(directory, this.#hooks) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const ids = names.map((name) => { if (!name.endsWith(DESCRIPTOR_SUFFIX)) throw new Error('Unknown portable asset repository entry'); const id = name.slice(0, -DESCRIPTOR_SUFFIX.length); assertId(id, 'Portable asset id'); return id }).sort()
    const assets = await Promise.all(ids.map((id) => this.read(id)))
    return assets.map(({ id, kind }) => ({ schemaVersion: 1, id, kind }))
  }

  async read(id: string): Promise<CodexPortableAsset> {
    const raw = await this.#readDescriptor(id)
    const descriptor = this.#validateDescriptor(raw, id)
    const manifest = await this.#manifests.read(this.#manifestId(id))
    const entries = new Map(manifest.entries.map((entry) => [entry.path, entry]))
    const files = descriptor.files ? await Promise.all(descriptor.files.map(async (file) => {
      const entry = entries.get(`files/${file.relativePath}`)
      if (!entry || entry.hash !== file.hash || entry.size !== file.size) throw new Error('Portable asset descriptor does not match its verified manifest')
      const object = await this.#objects.verify(file.hash)
      return { relativePath: file.relativePath, bytes: new Uint8Array(await readFile(object.path)), sha256: file.hash }
    })) : undefined
    if (entries.size !== (descriptor.files?.length ?? 0)) throw new Error('Portable asset manifest contains unreferenced entries')
    const asset: CodexPortableAsset = { schemaVersion: 1, id: descriptor.id, kind: descriptor.kind, name: descriptor.name, ...(files ? { files } : {}), ...(descriptor.metadata ? { metadata: descriptor.metadata } : {}), ...(descriptor.secretReferenceIds ? { secretReferenceIds: descriptor.secretReferenceIds } : {}) }
    if (digest(this.#digestPayload(asset)) !== descriptor.digest) throw new Error('Portable asset descriptor digest verification failed')
    return asset
  }

  async import(asset: CodexPortableAsset): Promise<{ readonly id: string; readonly digest: string }> {
    this.#validateAsset(asset)
    const assetDigest = digest(this.#digestPayload(asset))
    try {
      const existing = await this.read(asset.id)
      if (digest(this.#digestPayload(existing)) !== assetDigest) throw new Error('Portable asset id collision with different immutable content')
      return { id: asset.id, digest: assetDigest }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }

    const entries = []
    for (const file of asset.files ?? []) { const object = await this.#objects.ingestBytes(file.bytes); if (object.hash !== file.sha256) throw new Error('Portable asset file digest is invalid'); entries.push({ path: `files/${file.relativePath}`, hash: object.hash, size: object.size }) }
    const descriptor: PortableAssetDescriptor = { schemaVersion: 1, id: asset.id, kind: asset.kind, name: asset.name, ...(entries.length ? { files: entries.map((entry, index) => ({ relativePath: asset.files![index]!.relativePath, hash: entry.hash, size: entry.size })) } : {}), ...(asset.metadata ? { metadata: jsonMetadata(asset.metadata) } : {}), ...(asset.secretReferenceIds?.length ? { secretReferenceIds: [...asset.secretReferenceIds] } : {}), digest: assetDigest }
    try { await this.#manifests.write({ assetId: this.#manifestId(asset.id), entries }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const manifest = await this.#manifests.read(this.#manifestId(asset.id)); if (canonical(manifest.entries) !== canonical(entries)) throw new Error('Portable asset id collision with different immutable content')
    }
    const path = this.#descriptorPath(asset.id)
    await ensureOrdinaryDirectory(this.#extensionsRoot, dirname(path))
    try { await writeExclusiveDurable(path, `${JSON.stringify(descriptor, null, 2)}\n`, 0o600, 'descriptor-write', this.#hooks) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.read(asset.id); if (digest(this.#digestPayload(existing)) !== assetDigest) throw new Error('Portable asset id collision with different immutable content')
    }
    return { id: asset.id, digest: assetDigest }
  }

  async reuseMetrics(): Promise<{ portableAssetCount: number; logicalImmutableBytes: number; uniqueVerifiedObjectBytes: number; verifiedSavedBytes: number }> {
    const summaries = await this.list(); let logical = 0; const unique = new Map<string, number>()
    for (const summary of summaries) for (const file of (await this.read(summary.id)).files ?? []) { logical += file.bytes.byteLength; const prior = unique.get(file.sha256); if (prior !== undefined && prior !== file.bytes.byteLength) throw new Error('Verified object size evidence conflicts'); unique.set(file.sha256, file.bytes.byteLength) }
    const physical = [...unique.values()].reduce((sum, size) => sum + size, 0)
    return { portableAssetCount: summaries.length, logicalImmutableBytes: logical, uniqueVerifiedObjectBytes: physical, verifiedSavedBytes: Math.max(0, logical - physical) }
  }

  #digestPayload(asset: CodexPortableAsset): unknown { return { schemaVersion: 1, id: asset.id, kind: asset.kind, name: asset.name, files: asset.files?.map((file) => ({ relativePath: file.relativePath, sha256: file.sha256, size: file.bytes.byteLength })), metadata: asset.metadata, secretReferenceIds: asset.secretReferenceIds } }
  #validateAsset(asset: CodexPortableAsset): void {
    assertId(asset.id, 'Portable asset id'); if (asset.schemaVersion !== 1 || !['skill', 'instructions', 'mcp-server'].includes(asset.kind) || !asset.name) throw new Error('Portable asset is invalid')
    const paths = new Set<string>(); for (const file of asset.files ?? []) { if (!safeRelative(file.relativePath) || paths.has(file.relativePath) || !SHA256.test(file.sha256) || createHash('sha256').update(file.bytes).digest('hex') !== file.sha256) throw new Error('Portable asset file is invalid'); paths.add(file.relativePath) }
    jsonMetadata(asset.metadata); for (const reference of asset.secretReferenceIds ?? []) assertId(reference, 'Secret reference')
  }
  #validateDescriptor(raw: unknown, id: string): PortableAssetDescriptor {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Portable asset descriptor is invalid')
    const value = raw as Partial<PortableAssetDescriptor>; const allowed = ['schemaVersion', 'id', 'kind', 'name', 'files', 'metadata', 'secretReferenceIds', 'digest']
    if (Object.keys(value).some((key) => !allowed.includes(key)) || value.schemaVersion !== 1 || value.id !== id || !value.name || !['skill', 'instructions', 'mcp-server'].includes(value.kind as string) || !SHA256.test(value.digest ?? '')) throw new Error('Portable asset descriptor is invalid')
    if (value.files !== undefined && (!Array.isArray(value.files) || value.files.some((file) => !safeRelative(file.relativePath) || !SHA256.test(file.hash) || !Number.isSafeInteger(file.size) || file.size < 0))) throw new Error('Portable asset descriptor files are invalid')
    jsonMetadata(value.metadata); if (value.secretReferenceIds !== undefined && (!Array.isArray(value.secretReferenceIds) || value.secretReferenceIds.some((reference) => !SAFE_ID.test(reference)))) throw new Error('Portable asset secret references are invalid')
    return value as PortableAssetDescriptor
  }
}

/** Write-only opaque secret sink. Deliberately exposes no read or list method. */
export class AshCodexSecretRepository implements CodexSecretRepository {
  readonly #secretsRoot: string
  readonly #hooks?: AgentStorageIoHooks
  constructor(secretsRoot: string, hooks?: AgentStorageIoHooks) { this.#secretsRoot = resolve(secretsRoot); this.#hooks = hooks }
  async storeLiteral(input: { readonly value: string; readonly purpose: string }): Promise<string> {
    if (!input.value || !input.purpose || input.purpose.includes('\0')) throw new Error('Secret input is invalid')
    const reference = `secret-${randomUUID()}`; const directory = join(this.#secretsRoot, 'agent-secrets')
    await ensureOrdinaryDirectory(this.#secretsRoot, directory, 0o700)
    await writeExclusiveDurable(join(directory, `${reference}.json`), `${JSON.stringify({ schemaVersion: 1, purpose: input.purpose, value: input.value })}\n`, 0o600, 'secret-write', this.#hooks)
    return reference
  }
}

export interface AgentStorageProgress {
  operationId: string
  phase: 'applying' | 'completed' | 'rolling-back' | 'rolled-back' | 'failed'
  status: 'running' | 'completed' | 'failed'
  operationsCompleted: number
  operationsTotal: number
}

export interface AgentPlanPreview {
  planSessionId: string
  kind: 'import' | 'projection'
  expiresAt: string
  operations: Array<Pick<PreviewFileOperation, 'id' | 'kind' | 'rootId' | 'nativePath' | 'expectedBeforeSha256' | 'expectedAfterSha256'>>
}

export interface AgentOperationSummary {
  operationId: string
  adapterId: string
  installationId: string
  kind: 'import' | 'projection'
  phase: 'committed' | 'rolled-back'
  status: 'committed' | 'rolled-back'
  verified: boolean
  completedAt: string
  operationCount: number
  materializationStrategies?: { clone: number; copy: number }
}
export interface AgentOperationReadSummary {
  operationId: string
  adapterId: string
  installationId: string
  kind: 'import' | 'projection'
  phase: AdapterJournalPhase
  status: 'running' | 'recovering' | 'committed' | 'rolled-back'
  verified: boolean
  startedAt: string
  updatedAt: string
  operationCount: number
  materializationStrategies?: { clone: number; copy: number }
}

interface PlanSession { senderId: string; plan: AdapterPlan; expiresAt: number }
export interface AgentStorageOptions {
  resolve(group: StorageGroupId, ...segments: string[]): string
  homeDirectory?: string
  environment?: Readonly<Record<string, string | undefined>>
  now?: () => Date
  sessionTtlMs?: number
  onProgress?: (progress: AgentStorageProgress) => void
}

async function prepareCodexUserSkillRoot(homeDirectory: string, environment: Readonly<Record<string, string | undefined>>): Promise<void> {
  const configuredHome = environment.CODEX_HOME
  if (configuredHome && !isAbsolute(configuredHome)) return
  const codexHome = resolve(configuredHome || join(homeDirectory, '.codex'))
  let installed
  try { installed = await lstat(codexHome) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  if (!installed.isDirectory() || installed.isSymbolicLink()) return

  const agentsRoot = join(homeDirectory, '.agents')
  await ensureOrdinaryChildDirectory(homeDirectory, agentsRoot)
  await ensureOrdinaryChildDirectory(agentsRoot, join(agentsRoot, 'skills'))
}

function publicInstallation(value: AgentInstallation) { return { id: value.id, displayName: value.displayName, nativeRoots: value.nativeRoots.map((root) => ({ id: root.id, path: root.path })) } }
function publicOperations(plan: AdapterPlan): AgentPlanPreview['operations'] { return plan.operations.map(({ id, kind, rootId, nativePath, expectedBeforeSha256, expectedAfterSha256 }) => ({ id, kind, rootId, nativePath, ...(expectedBeforeSha256 ? { expectedBeforeSha256 } : {}), ...(expectedAfterSha256 ? { expectedAfterSha256 } : {}) })) }
function resultSummary(plan: AdapterPlan, result: AdapterResult): AgentOperationSummary {
  const strategies = result.materializationStrategies?.reduce((counts, item) => { counts[item.strategy]++; return counts }, { clone: 0, copy: 0 })
  return { operationId: result.operationId, adapterId: result.adapterId, installationId: result.installationId, kind: plan.kind, phase: result.status === 'rolled-back' ? 'rolled-back' : 'committed', status: result.status === 'rolled-back' ? 'rolled-back' : 'committed', verified: result.verified, completedAt: result.completedAt, operationCount: plan.operations.length, ...(strategies ? { materializationStrategies: strategies } : {}) }
}
function durableResultSummary(value: Awaited<ReturnType<ProjectionCoordinator['getOperationSummary']>>): AgentOperationSummary {
  if (!value || (value.phase !== 'committed' && value.phase !== 'rolled-back')) throw new Error('Agent operation does not have terminal verified evidence')
  return { operationId: value.operationId, adapterId: value.adapterId, installationId: value.installationId, kind: value.kind, phase: value.phase, status: value.phase, verified: value.verified, completedAt: value.updatedAt, operationCount: value.operationCount, ...(value.materializationStrategies ? { materializationStrategies: value.materializationStrategies } : {}) }
}
function durableOperationSummary(value: NonNullable<Awaited<ReturnType<ProjectionCoordinator['getOperationSummary']>>>): AgentOperationReadSummary {
  const status = value.phase === 'committed' || value.phase === 'rolled-back' ? value.phase : value.phase === 'rolling-back' || value.phase === 'aborting-claims' ? 'recovering' : 'running'
  return { operationId: value.operationId, adapterId: value.adapterId, installationId: value.installationId, kind: value.kind, phase: value.phase, status, verified: value.verified, startedAt: value.startedAt, updatedAt: value.updatedAt, operationCount: value.operationCount, ...(value.materializationStrategies ? { materializationStrategies: value.materializationStrategies } : {}) }
}

/** One Backend-owned composition shared by read-only routes and trusted Desktop IPC. */
export async function createAgentStorageComposition(options: AgentStorageOptions) {
  const now = options.now ?? (() => new Date()); const assets = new AshCodexPortableAssetRepository(options.resolve('extensions')); const secrets = new AshCodexSecretRepository(options.resolve('secrets'))
  const environment = Object.freeze({ CODEX_HOME: options.environment?.CODEX_HOME })
  const homeDirectory = options.homeDirectory ?? homedir()
  await prepareCodexUserSkillRoot(homeDirectory, environment)
  const adapter = new CodexAdapter({ environment: { homeDirectory, env: environment }, assets, secrets, now })
  const registry = new AdapterRegistry([adapter])
  const coordinator = new ProjectionCoordinator({ stateRoot: options.resolve('config', 'agent-coordination', 'state'), coordinationRoot: options.resolve('config', 'agent-coordination', 'locks'), registry, now })
  await coordinator.recoverPending()
  const sessions = new Map<string, PlanSession>()
  const installation = async (adapterId: string, installationId: string) => {
    if (adapterId !== adapter.id) throw Object.assign(new Error('Agent adapter was not found'), { code: 'AGENT_ADAPTER_NOT_FOUND' })
    const found = (await coordinator.detect(adapterId)).find((item) => item.id === installationId)
    if (!found) throw Object.assign(new Error('Agent installation was not found'), { code: 'AGENT_INSTALLATION_NOT_FOUND' })
    return found
  }
  const preview = (plan: AdapterPlan, senderId: string): AgentPlanPreview => {
    const currentTime = now().getTime(); for (const [id, session] of sessions) if (session.expiresAt <= currentTime || (session.senderId === senderId && session.plan.kind === plan.kind)) sessions.delete(id)
    const planSessionId = randomUUID(); const expiresAt = Math.min(Date.parse(plan.expiresAt), currentTime + (options.sessionTtlMs ?? 5 * 60_000)); sessions.set(planSessionId, { senderId, plan, expiresAt })
    return { planSessionId, kind: plan.kind, expiresAt: new Date(expiresAt).toISOString(), operations: publicOperations(plan) }
  }
  const readModel = {
    async agents() {
      const operations = (await coordinator.listOperationSummaries()).map(durableOperationSummary)
      try { const installations = await coordinator.detect(adapter.id); return { adapters: [{ id: adapter.id, displayName: adapter.displayName, status: installations.length ? 'detected' as const : 'not-detected' as const, installations: installations.map(publicInstallation) }], operations } }
      catch { return { adapters: [{ id: adapter.id, displayName: adapter.displayName, status: 'error' as const, installations: [], error: { code: 'AGENT_DETECTION_FAILED', message: 'Codex storage detection is unavailable' } }], operations } }
    },
    async assets(adapterId: string, installationId: string) {
      const target = await installation(adapterId, installationId)
      return { inventory: await coordinator.inspect(adapterId, target), portableAssets: await assets.list() }
    },
    async reuse() { try { const metrics = await assets.reuseMetrics(); const terminal = (await coordinator.listOperationSummaries()).filter((value) => value.kind === 'projection' && (value.phase === 'committed' || value.phase === 'rolled-back')); const complete = terminal.length > 0 && terminal.every((value) => value.verified && value.strategyEvidenceComplete); const materializationStrategies = terminal.reduce((counts, value) => { counts.clone += value.materializationStrategies?.clone ?? 0; counts.copy += value.materializationStrategies?.copy ?? 0; return counts }, { clone: 0, copy: 0 }); return { scanStatus: 'complete' as const, evidenceStatus: complete ? 'verified' as const : 'unavailable' as const, ...metrics, materializationStrategies: complete ? materializationStrategies : null, ...(!complete ? { blockers: [{ code: 'agent-materialization-evidence-incomplete', detail: terminal.length ? 'A durable projection journal lacks complete clone/copy strategy evidence' : 'No durable projection journal provides clone/copy strategy evidence' }] } : {}) } } catch (error) { return { scanStatus: 'degraded' as const, evidenceStatus: 'unavailable' as const, portableAssetCount: 0, logicalImmutableBytes: null, uniqueVerifiedObjectBytes: null, verifiedSavedBytes: null, materializationStrategies: null, blockers: [{ code: 'agent-asset-verification-failed', detail: (error as Error).message }] } } },
    async operation(operationId: string) { const value = await coordinator.getOperationSummary(operationId); if (!value) throw Object.assign(new Error('Agent operation was not found'), { code: 'AGENT_OPERATION_NOT_FOUND' }); return durableOperationSummary(value) },
  }
  const mutations = {
    async previewImport(adapterId: string, installationId: string, assetIds: readonly string[], senderId: string) { return preview(await coordinator.planImport(adapterId, { schemaVersion: 1, assetIds: [...assetIds] }, await installation(adapterId, installationId)), senderId) },
    async previewProjection(adapterId: string, installationId: string, assetIds: readonly string[], senderId: string) { return preview(await coordinator.planProjection(adapterId, { schemaVersion: 1, assetIds: [...assetIds] }, await installation(adapterId, installationId)), senderId) },
    async apply(planSessionId: string, senderId: string) {
      const currentTime = now().getTime(); for (const [id, candidate] of sessions) if (candidate.expiresAt <= currentTime && id !== planSessionId) sessions.delete(id)
      const session = sessions.get(planSessionId)
      if (!session) throw Object.assign(new Error('Plan session is unknown or reused'), { code: 'AGENT_PLAN_SESSION_INVALID' })
      if (session.senderId !== senderId) throw Object.assign(new Error('Plan session belongs to a foreign sender'), { code: 'AGENT_PLAN_SESSION_INVALID' })
      sessions.delete(planSessionId)
      if (session.expiresAt <= currentTime) throw Object.assign(new Error('Plan session has expired'), { code: 'AGENT_PLAN_SESSION_INVALID' })
      const approved = coordinator.approve(session.plan); const operationId = approved.approval.operationId; const total = approved.operations.length
      options.onProgress?.({ operationId, phase: 'applying', status: 'running', operationsCompleted: 0, operationsTotal: total })
      try { const result = await coordinator.apply(approved); const summary = resultSummary(session.plan, result); options.onProgress?.({ operationId, phase: 'completed', status: 'completed', operationsCompleted: total, operationsTotal: total }); return { operationId, result: summary } }
      catch (error) { options.onProgress?.({ operationId, phase: 'failed', status: 'failed', operationsCompleted: 0, operationsTotal: total }); throw error }
    },
    async rollback(operationId: string) {
      const prior = await coordinator.getOperationSummary(operationId); if (!prior || prior.phase !== 'committed') throw Object.assign(new Error('Agent operation was not found or is not rollback eligible'), { code: 'AGENT_OPERATION_NOT_FOUND' })
      options.onProgress?.({ operationId, phase: 'rolling-back', status: 'running', operationsCompleted: 0, operationsTotal: prior.operationCount })
      try { await coordinator.rollback(operationId); const summary = durableResultSummary(await coordinator.getOperationSummary(operationId)); options.onProgress?.({ operationId, phase: 'rolled-back', status: 'completed', operationsCompleted: prior.operationCount, operationsTotal: prior.operationCount }); return summary }
      catch (error) { options.onProgress?.({ operationId, phase: 'failed', status: 'failed', operationsCompleted: 0, operationsTotal: prior.operationCount }); throw error }
    },
  }
  return { readModel, mutations, coordinator, assets, secrets }
}
