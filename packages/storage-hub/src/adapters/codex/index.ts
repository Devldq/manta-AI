import { createHash } from 'node:crypto'
import { lstat, type FileHandle } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { AdapterResult, AgentAdapter, AgentAsset, AgentAssetInventory, AgentInstallation, ApprovedAdapterPlan, AssetSelection, ImportPlan, PreviewFileOperation, ProjectionPlan } from '../types'
import { detectCodex, type CodexEnvironment } from './detect'
import { activeInstructions, instructionFilePaths, instructionFiles } from './instructions'
import { appendMcpServers, parseMcpServers, renderMcpServer, type PortableMcpServer } from './mcp'
import { discoverSkills, listSkillFilePaths } from './skills'
import { readOrdinaryNoFollow, readOrdinarySnapshotNoFollow, withOrdinaryNoFollowWritable } from './native-io'

export * from './detect'; export * from './instructions'; export * from './mcp'; export { discoverSkills, listSkillFilePaths } from './skills'; export type { NativeSkill, NativeSkillFile } from './skills'
export type CodexPortableAssetKind = 'skill' | 'instructions' | 'mcp-server'
export interface CodexPortableFile { readonly relativePath: string; readonly bytes: Uint8Array; readonly sha256: string }
export interface CodexPortableAsset { readonly schemaVersion: 1; readonly id: string; readonly kind: CodexPortableAssetKind; readonly name: string; readonly files?: readonly CodexPortableFile[]; readonly metadata?: PortableMcpServer | Readonly<Record<string, unknown>>; readonly secretReferenceIds?: readonly string[] }
export interface CodexPortableAssetSummary { readonly schemaVersion: 1; readonly id: string; readonly kind: CodexPortableAssetKind }
export interface CodexPortableAssetRepository { list(): Promise<readonly CodexPortableAssetSummary[]>; read(id: string): Promise<CodexPortableAsset>; import(asset: CodexPortableAsset): Promise<{ readonly id: string; readonly digest: string }> }
export interface CodexSecretRepository { storeLiteral(input: { readonly value: string; readonly purpose: string }): Promise<string> }
export interface CodexClaimMaterializer { cloneIntoClaim?(claim: FileHandle, bytes: Uint8Array): Promise<void>; copyIntoClaim?(claim: FileHandle, bytes: Uint8Array): Promise<void> }
export interface CodexAdapterOptions { readonly environment: CodexEnvironment; readonly assets: CodexPortableAssetRepository; readonly secrets: CodexSecretRepository; readonly materializer?: CodexClaimMaterializer; readonly now?: () => Date }

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const safe = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
function boundedId(prefix: string, value: string): string { const direct = `${prefix}${value}`; if (direct.length <= 128) return direct; const suffix = `-${hash(value).slice(0, 16)}`; return `${prefix}${value.slice(0, 128 - prefix.length - suffix.length)}${suffix}` }
async function exists(path: string) { try { return await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } }
function root(target: AgentInstallation, id: string): string { const found = target.nativeRoots.find((item) => item.id === id); if (!found) throw new Error(`Codex installation lacks ${id}`); return found.path }

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex'; readonly displayName = 'Codex'; readonly #environment: CodexEnvironment; readonly #assets: CodexPortableAssetRepository; readonly #secrets: CodexSecretRepository; readonly #materializer: CodexClaimMaterializer; readonly #now: () => Date
  constructor(options: CodexAdapterOptions) { this.#environment = options.environment; this.#assets = options.assets; this.#secrets = options.secrets; this.#materializer = options.materializer ?? {}; this.#now = options.now ?? (() => new Date()) }
  detect() { return detectCodex(this.#environment) }

  async inspect(target: AgentInstallation): Promise<AgentAssetInventory> {
    const assets: AgentAsset[] = []; const instruction = await activeInstructions(root(target, 'codex-home'))
    if (instruction) assets.push({ id: 'codex-instructions', kind: 'instructions', nativePath: instruction.nativePath, metadata: { fileName: instruction.fileName } })
    for (const skill of await discoverSkills(root(target, 'user-skills'))) assets.push({ id: boundedId('codex-skill-', skill.name), kind: 'skill', nativePath: skill.directory, metadata: { name: skill.name, fileCount: skill.files.length } })
    const configPath = join(root(target, 'codex-home'), 'config.toml'); if (await exists(configPath)) for (const server of parseMcpServers((await readOrdinaryNative(configPath)).toString('utf8'))) assets.push({ id: boundedId('codex-mcp-', server.name), kind: 'mcp-server', nativePath: configPath, metadata: { name: server.name, ...server.metadata, secretFieldNames: server.literals.map((item) => item.field) } })
    assets.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1); return { schemaVersion: 1, installationId: target.id, assets }
  }

  async planImport(target: AgentInstallation): Promise<ImportPlan> {
    const operations: PreviewFileOperation[] = []; for (const skill of await discoverSkills(root(target, 'user-skills'))) for (const file of skill.files) operations.push({ id: `read-skill-${hash(`${skill.name}:${file.relativePath}`).slice(0, 16)}`, kind: 'read', rootId: 'user-skills', nativePath: file.nativePath })
    for (const instruction of await instructionFiles(root(target, 'codex-home'))) operations.push({ id: instruction.fileName === 'AGENTS.override.md' ? 'read-instructions-override' : 'read-instructions-base', kind: 'read', rootId: 'codex-home', nativePath: instruction.nativePath })
    const config = join(root(target, 'codex-home'), 'config.toml'); if (await exists(config)) operations.push({ id: 'read-mcp-config', kind: 'read', rootId: 'codex-home', nativePath: config })
    return this.#plan('import', target, operations) as ImportPlan
  }

  async planProjection(selection: AssetSelection, target: AgentInstallation): Promise<ProjectionPlan> {
    const operations: PreviewFileOperation[] = []; const mcp: { name: string; metadata: PortableMcpServer }[] = []
    const assetDigests: Record<string, string> = {}
    for (const id of selection.assetIds) {
      const asset = await this.#assets.read(id); validatePortableAsset(asset, id)
      assetDigests[id] = assetDigest(asset)
      if (asset.kind === 'skill') {
        const directory = join(root(target, 'user-skills'), asset.name); if (await exists(directory)) throw new Error(`Codex skill projection conflict: ${asset.name}`)
        operations.push({ id: boundedId('directory-', asset.id), kind: 'create-directory', rootId: 'user-skills', nativePath: directory })
        const directories = new Set<string>()
        for (const file of asset.files ?? []) { if (!file.relativePath.split('/').every(safe) || hash(file.bytes) !== file.sha256) throw new Error('Malformed portable skill file'); let parent = dirname(join(directory, ...file.relativePath.split('/'))); while (parent !== directory) { directories.add(parent); parent = dirname(parent) } }
        for (const path of [...directories].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) operations.push({ id: `directory-${hash(path).slice(0, 16)}`, kind: 'create-directory', rootId: 'user-skills', nativePath: path })
        for (const file of asset.files ?? []) operations.push({ id: `file-${hash(`${asset.id}:${file.relativePath}`).slice(0, 16)}`, kind: 'create', rootId: 'user-skills', nativePath: join(directory, ...file.relativePath.split('/')), expectedAfterSha256: file.sha256 })
      } else if (asset.kind === 'instructions') {
        const file = asset.files?.[0]; if (!file || hash(file.bytes) !== file.sha256) throw new Error('Malformed instructions asset'); const nativePath = join(root(target, 'codex-home'), asset.name); const stat = await exists(nativePath); operations.push({ id: 'project-instructions', kind: stat ? 'modify' : 'create', rootId: 'codex-home', nativePath, expectedAfterSha256: file.sha256 })
      } else { const metadata = asset.metadata as PortableMcpServer; if (metadata.secretBindings?.some((binding) => binding.field.startsWith('url.'))) throw new Error(`MCP URL secret binding is unresolved for ${asset.name}`); if (mcp.some((item) => item.name === asset.name)) throw new Error(`Duplicate selected MCP server conflict: ${asset.name}`); mcp.push({ name: asset.name, metadata }) }
    }
    if (mcp.length) { const path = join(root(target, 'codex-home'), 'config.toml'); const existing = await exists(path); const before = existing ? (await readOrdinaryNative(path)).toString('utf8') : ''; const after = appendMcpServers(before, mcp); operations.push({ id: 'project-mcp-config', kind: existing ? 'modify' : 'create', rootId: 'codex-home', nativePath: path, expectedAfterSha256: hash(after) }) }
    return { ...(this.#plan('projection', target, operations) as ProjectionPlan), selection: { ...structuredClone(selection), assetDigests } }
  }

  async apply(plan: ApprovedAdapterPlan): Promise<AdapterResult> {
    const secretReferenceIds: string[] = []; const materializationStrategies: { operationId: string; strategy: 'clone' | 'copy' }[] = []
    if (plan.kind === 'import') {
      const skillRoot = root(plan.target, 'user-skills'); const skillOperations = plan.operations.filter((operation) => operation.id.startsWith('read-skill-')); const currentSkillPaths = await listSkillFilePaths(skillRoot); const approvedSkillPaths = skillOperations.map((operation) => operation.nativePath).sort((a, b) => a < b ? -1 : a > b ? 1 : 0); if (JSON.stringify(currentSkillPaths) !== JSON.stringify(approvedSkillPaths)) throw new Error('Native Codex skill file set changed after approval')
      const grouped = new Map<string, CodexPortableFile[]>(); for (const operation of skillOperations) { const relativePath = relative(skillRoot, operation.nativePath).split(sep).join('/'); const [name, ...parts] = relativePath.split('/'); if (!safe(name) || !parts.length) throw new Error('Approved Codex skill path is malformed'); const bytes = await approvedRead(operation); const values = grouped.get(name) ?? []; values.push({ relativePath: parts.join('/'), bytes, sha256: hash(bytes) }); grouped.set(name, values) }
      for (const [name, files] of grouped) await this.#assets.import({ schemaVersion: 1, id: boundedId('codex-skill-', name), kind: 'skill', name, files: files.sort((a, b) => a.relativePath < b.relativePath ? -1 : 1) })
      const instructionOperations = plan.operations.filter((operation) => operation.id.startsWith('read-instructions-')); const approvedInstructionPaths = instructionOperations.map((item) => item.nativePath); if (JSON.stringify(await instructionFilePaths(root(plan.target, 'codex-home'))) !== JSON.stringify(approvedInstructionPaths)) throw new Error('Native Codex instruction file set changed after approval'); const instructionSnapshots = []; for (const operation of instructionOperations) instructionSnapshots.push({ name: operation.id.endsWith('override') ? 'AGENTS.override.md' : 'AGENTS.md', bytes: await approvedRead(operation) }); const active = instructionSnapshots.find((item) => item.name === 'AGENTS.override.md' && item.bytes.toString().trim()) ?? instructionSnapshots.find((item) => item.name === 'AGENTS.md' && item.bytes.toString().trim()); if (active) await this.#assets.import({ schemaVersion: 1, id: 'codex-instructions', kind: 'instructions', name: active.name, files: [{ relativePath: active.name, bytes: active.bytes, sha256: hash(active.bytes) }] })
      const configOperation = plan.operations.find((operation) => operation.id === 'read-mcp-config'); const currentConfig = await exists(join(root(plan.target, 'codex-home'), 'config.toml')); if (!configOperation && currentConfig) throw new Error('Native Codex MCP config appeared after approval'); if (configOperation) for (const server of parseMcpServers((await approvedRead(configOperation)).toString())) { const bindings = []; for (const literal of server.literals) { const secretReferenceId = await this.#secrets.storeLiteral({ value: literal.value, purpose: `codex-mcp:${server.name}:${literal.field}` }); secretReferenceIds.push(secretReferenceId); bindings.push({ field: literal.field, secretReferenceId }) } const metadata = projectionSafeMetadata(server.name, server.metadata, bindings); await this.#assets.import({ schemaVersion: 1, id: boundedId('codex-mcp-', server.name), kind: 'mcp-server', name: server.name, metadata, ...(bindings.length ? { secretReferenceIds: bindings.map((item) => item.secretReferenceId) } : {}) }) }
    } else {
      const selected = new Map<string, CodexPortableAsset>(); for (const id of plan.selection.assetIds) { const asset = await this.#assets.read(id); validatePortableAsset(asset, id); if (assetDigest(asset) !== plan.selection.assetDigests?.[id]) throw new Error(`Portable asset snapshot changed after planning: ${id}`); selected.set(id, asset) }
      let mcpOutput: Uint8Array | undefined
      const mcpAssets = [...selected.values()].filter((asset) => asset.kind === 'mcp-server'); if (mcpAssets.length) { const operation = plan.operations.find((item) => item.id === 'project-mcp-config'); if (!operation) throw new Error('Approved MCP projection operation is missing'); const before = operation.kind === 'create' ? '' : (await readOrdinaryNoFollow(operation.nativePath)).toString('utf8'); mcpOutput = Buffer.from(appendMcpServers(before, mcpAssets.map((asset) => ({ name: asset.name, metadata: asset.metadata as PortableMcpServer })))) }
      for (const operation of plan.operations) { if (operation.kind !== 'create' && operation.kind !== 'modify') continue; let bytes: Uint8Array | undefined
        if (operation.id === 'project-mcp-config') bytes = mcpOutput
        else for (const asset of selected.values()) { const base = asset.kind === 'skill' ? join(root(plan.target, 'user-skills'), asset.name) : asset.kind === 'instructions' ? root(plan.target, 'codex-home') : undefined; if (!base) continue; const file = asset.files?.find((candidate) => resolve(base, ...candidate.relativePath.split('/')) === resolve(operation.nativePath)); if (file) { bytes = file.bytes; break } }
        if (!bytes || hash(bytes) !== operation.expectedAfterSha256) throw new Error(`Codex projection bytes do not match approved operation ${operation.id}`); materializationStrategies.push({ operationId: operation.id, strategy: await materializeClaim(operation.nativePath, bytes, this.#materializer) })
      }
    }
    return { schemaVersion: 1, operationId: plan.approval.operationId, planId: plan.planId, adapterId: this.id, installationId: plan.target.id, status: 'applied', verified: true, completedAt: this.#now().toISOString(), ...(secretReferenceIds.length ? { secretReferenceIds: [...new Set(secretReferenceIds)].sort() } : {}), ...(materializationStrategies.length ? { materializationStrategies } : {}) }
  }

  #plan(kind: 'import' | 'projection', target: AgentInstallation, operations: readonly PreviewFileOperation[]): ImportPlan | ProjectionPlan { const createdAt = this.#now(); return { schemaVersion: 1, kind, planId: `codex-${kind}-${createdAt.getTime()}`, adapterId: this.id, target: structuredClone(target), ...(kind === 'projection' ? { selection: { schemaVersion: 1, assetIds: [] } } : {}), operations, createdAt: createdAt.toISOString(), expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000).toISOString(), digest: '' } as ImportPlan | ProjectionPlan }
}

async function copyIntoClaim(handle: FileHandle, bytes: Uint8Array): Promise<void> { await handle.truncate(0); await handle.writeFile(bytes) }
function assetDigest(asset: CodexPortableAsset): string { return hash(JSON.stringify(asset, (_key, value) => value instanceof Uint8Array ? [...value] : value)) }
function validatePortableAsset(asset: CodexPortableAsset, expectedId: string): void {
  if (!asset || asset.schemaVersion !== 1 || asset.id !== expectedId || !safe(asset.id) || !safe(asset.name) || !['skill', 'instructions', 'mcp-server'].includes(asset.kind)) throw new Error('Malformed portable Codex asset identity or kind')
  if (asset.kind === 'skill') { if (!Array.isArray(asset.files) || !asset.files.length) throw new Error('Portable skill requires files'); const paths = new Set<string>(); for (const file of asset.files) { if (!file || !safeRelativeAssetPath(file.relativePath) || paths.has(file.relativePath) || !(file.bytes instanceof Uint8Array) || hash(file.bytes) !== file.sha256) throw new Error('Malformed or duplicate portable skill file'); paths.add(file.relativePath) } if (!paths.has('SKILL.md')) throw new Error('Portable skill requires SKILL.md'); return }
  if (asset.kind === 'instructions') { if (!['AGENTS.md', 'AGENTS.override.md'].includes(asset.name) || asset.files?.length !== 1 || asset.files[0].relativePath !== asset.name || !(asset.files[0].bytes instanceof Uint8Array) || hash(asset.files[0].bytes) !== asset.files[0].sha256) throw new Error('Malformed portable instructions asset'); return }
  if (asset.files !== undefined || !asset.metadata || typeof asset.metadata !== 'object') throw new Error('Malformed portable MCP asset')
  const metadata = asset.metadata as PortableMcpServer; const allowed = ['transport', 'command', 'args', 'url', 'envVars', 'envHttpHeaders', 'bearerTokenEnvVar', 'secretBindings', 'options']; if (Object.keys(metadata).some((key) => !allowed.includes(key))) throw new Error('Portable MCP asset contains unknown metadata')
  if (metadata.secretBindings !== undefined && (!Array.isArray(metadata.secretBindings) || metadata.secretBindings.some((item) => !item || typeof item.field !== 'string' || !safe(item.secretReferenceId ?? '')))) throw new Error('Malformed portable MCP secret binding')
  parseMcpServers(renderMcpServer(asset.name, metadata))
}
function safeRelativeAssetPath(path: string): boolean { return typeof path === 'string' && path.length > 0 && path.split('/').every((part) => safe(part)) }
async function approvedRead(operation: PreviewFileOperation): Promise<Buffer> { const snapshot = await readOrdinarySnapshotNoFollow(operation.nativePath); if (snapshot.identity !== operation.expectedBeforeIdentity || hash(snapshot.bytes) !== operation.expectedBeforeSha256) throw new Error('Approved Codex import path changed before read'); return snapshot.bytes }
const readOrdinaryNative = readOrdinaryNoFollow
function projectionSafeMetadata(name: string, metadata: PortableMcpServer, bindings: readonly { field: string; secretReferenceId: string }[]): PortableMcpServer {
  const result: PortableMcpServer = structuredClone({ ...metadata, ...(bindings.length ? { secretBindings: bindings } : {}) })
  if (result.transport === 'stdio') { const env = bindings.filter((item) => item.field.startsWith('env.')).map((item) => item.field.slice(4)); return { ...result, ...(env.length ? { envVars: [...new Set([...(result.envVars ?? []), ...env])].sort() } : {}) } }
  const headers = { ...(result.envHttpHeaders ?? {}) }; for (const binding of bindings.filter((item) => item.field.startsWith('http_headers.'))) headers[binding.field.slice('http_headers.'.length)] = `ASH_MCP_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_${hash(binding.field).slice(0, 12).toUpperCase()}`
  return { ...result, ...(Object.keys(headers).length ? { envHttpHeaders: headers } : {}) }
}
async function materializeClaim(path: string, bytes: Uint8Array, materializer: CodexClaimMaterializer): Promise<'clone' | 'copy'> {
  return withOrdinaryNoFollowWritable(path, async (handle) => { let strategy: 'clone' | 'copy' = 'copy'; if (materializer.cloneIntoClaim) { try { await materializer.cloneIntoClaim(handle, bytes); strategy = 'clone' } catch (error) { if (!['ENOTSUP', 'EXDEV', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; await (materializer.copyIntoClaim ?? copyIntoClaim)(handle, bytes) } } else await (materializer.copyIntoClaim ?? copyIntoClaim)(handle, bytes); return strategy })
}
