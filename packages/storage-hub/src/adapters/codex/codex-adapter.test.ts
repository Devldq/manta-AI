import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../adapter-registry'
import { ProjectionCoordinator } from '../projection-coordinator'
import { CodexAdapter, parseMcpServers, renderMcpServer, type CodexPortableAsset, type CodexPortableAssetRepository, type CodexSecretRepository } from './index'

const roots: string[] = []
async function temporary(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ash-codex-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

class Assets implements CodexPortableAssetRepository {
  readonly values = new Map<string, CodexPortableAsset>()
  async list() { return [...this.values.values()].map(({ id, kind }) => ({ schemaVersion: 1 as const, id, kind })) }
  async read(id: string) { const value = this.values.get(id); if (!value) throw new Error('missing asset'); return structuredClone(value) }
  async import(asset: CodexPortableAsset) { this.values.set(asset.id, structuredClone(asset)); return { id: asset.id, digest: sha256(JSON.stringify(asset, (_key, value) => value instanceof Uint8Array ? [...value] : value)) } }
}

class Secrets implements CodexSecretRepository {
  readonly values = new Map<string, string>()
  async storeLiteral(input: { value: string }) { const id = `secret-${this.values.size + 1}`; this.values.set(id, input.value); return id }
  async resolve(id: string) { const value = this.values.get(id); if (!value) throw new Error('missing secret'); return value }
}

function adapter(home: string, assets = new Assets(), secrets = new Secrets(), env: Readonly<Record<string, string | undefined>> = {}) {
  return { adapter: new CodexAdapter({ environment: { homeDirectory: home, env }, assets, secrets, now: () => new Date('2026-07-15T00:00:00.000Z') }), assets, secrets }
}

describe('Codex detection and inventory', () => {
  it('detects explicit and default CODEX_HOME with the official user skills root without writing', async () => {
    const home = await temporary(); const explicit = join(home, 'portable-codex'); await mkdir(explicit); await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    const detected = await adapter(home, new Assets(), new Secrets(), { CODEX_HOME: explicit }).adapter.detect()
    expect(detected[0].nativeRoots).toEqual([{ id: 'codex-home', path: explicit }, { id: 'user-skills', path: join(home, '.agents', 'skills') }])
    const fallback = join(home, '.codex'); await mkdir(fallback); expect((await adapter(home).adapter.detect())[0].nativeRoots[0].path).toBe(fallback)
  })

  it('rejects a relative explicit CODEX_HOME instead of resolving it against process cwd', async () => {
    const home = await temporary(); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); await expect(adapter(home, new Assets(), new Secrets(), { CODEX_HOME: 'relative-codex' }).adapter.detect()).rejects.toThrow(/CODEX_HOME.*absolute|absolute.*CODEX_HOME/i)
  })

  it('falls back from an empty override to AGENTS.md and projects global instructions', async () => {
    const home = await temporary(); const codex = join(home, '.codex'); await mkdir(codex); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); await writeFile(join(codex, 'AGENTS.override.md'), '  \n'); await writeFile(join(codex, 'AGENTS.md'), 'base guidance')
    const { adapter: instance, assets } = adapter(home); const target = (await instance.detect())[0]; const inventory = await instance.inspect(target); expect(inventory.assets[0].nativePath).toBe(join(codex, 'AGENTS.md'))
    assets.values.set('portable-instructions', { schemaVersion: 1, id: 'portable-instructions', kind: 'instructions', name: 'AGENTS.override.md', files: [{ relativePath: 'AGENTS.override.md', bytes: new TextEncoder().encode('portable guidance'), sha256: sha256('portable guidance') }] })
    await rm(join(codex, 'AGENTS.override.md')); const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); await coordinator.apply(coordinator.approve(await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: ['portable-instructions'] }, target)))
    expect(await readFile(join(codex, 'AGENTS.override.md'), 'utf8')).toBe('portable guidance')
  })

  it('inventories safe ordinary skill trees and only the active non-empty global instructions file', async () => {
    const home = await temporary(); const codex = join(home, '.codex'); const skills = join(home, '.agents', 'skills'); await mkdir(join(skills, 'writer', 'references'), { recursive: true }); await mkdir(codex)
    await writeFile(join(skills, 'writer', 'SKILL.md'), '# Writer'); await writeFile(join(skills, 'writer', 'references', 'guide.md'), 'guide'); await writeFile(join(codex, 'AGENTS.md'), 'base'); await writeFile(join(codex, 'AGENTS.override.md'), 'override')
    const instance = adapter(home).adapter; const inventory = await instance.inspect((await instance.detect())[0])
    expect(inventory.assets.map((asset) => [asset.kind, asset.id])).toEqual([['instructions', 'codex-instructions'], ['skill', 'codex-skill-writer']])
    expect(inventory.assets.find((asset) => asset.kind === 'instructions')?.nativePath).toBe(join(codex, 'AGENTS.override.md'))
    const outside = join(home, 'outside'); await mkdir(outside); await symlink(outside, join(skills, 'writer', 'linked'), 'junction')
    await expect(instance.inspect((await instance.detect())[0])).rejects.toThrow(/linked|symbolic|ordinary/i)
  })

  it('uses the same bounded deterministic asset id for a long skill name in inspect and import', async () => {
    const home = await temporary(); const name = `skill-${'x'.repeat(120)}`; const skill = join(home, '.agents', 'skills', name); await mkdir(skill, { recursive: true }); await mkdir(join(home, '.codex')); await writeFile(join(skill, 'SKILL.md'), 'long skill')
    const { adapter: instance, assets } = adapter(home); const target = (await instance.detect())[0]; const inventoryId = (await instance.inspect(target)).assets[0].id; expect(inventoryId.length).toBeLessThanOrEqual(128); expect(inventoryId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); await coordinator.apply(coordinator.approve(await coordinator.planImport('codex', target))); expect([...assets.values.keys()]).toEqual([inventoryId])
  })

  it('generates unique import operation ids when multiple skills contain SKILL.md', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); for (const name of ['one', 'two']) { const path = join(home, '.agents', 'skills', name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), name) }
    const instance = adapter(home).adapter; const plan = await instance.planImport((await instance.detect())[0]); expect(new Set(plan.operations.map((operation) => operation.id)).size).toBe(plan.operations.length)
  })

  it('imports AGENTS.md when an already-approved override is empty', async () => {
    const home = await temporary(); const codex = join(home, '.codex'); await mkdir(codex); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); await writeFile(join(codex, 'AGENTS.override.md'), ' \n'); await writeFile(join(codex, 'AGENTS.md'), 'active')
    const { adapter: instance, assets } = adapter(home); const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); await coordinator.apply(coordinator.approve(await coordinator.planImport('codex', target))); expect(assets.values.get('codex-instructions')?.name).toBe('AGENTS.md')
  })
})

describe('Codex MCP secret separation', () => {
  it('keeps environment names portable, extracts literals to opaque refs only during approved import, and preserves unrelated TOML', async () => {
    const home = await temporary(); const codex = join(home, '.codex'); const skills = join(home, '.agents', 'skills'); await mkdir(codex); await mkdir(skills, { recursive: true })
    const literal = 'fixture-literal-never-portable'; const config = `model = "gpt-fixture"\n# keep this comment\n[mcp_servers.local]\ncommand = "tool"\nenv_vars = ["SAFE_NAME"]\nenv = { API_KEY = "${literal}" }\n[mcp_servers.remote]\nurl = "https://example.test/mcp"\nbearer_token_env_var = "REMOTE_TOKEN"\n`
    await writeFile(join(codex, 'config.toml'), config)
    const { adapter: instance, assets, secrets } = adapter(home); const target = (await instance.detect())[0]; const inventory = await instance.inspect(target)
    expect(JSON.stringify(inventory)).not.toContain(literal)
    const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') })
    const result = await coordinator.apply(coordinator.approve(await coordinator.planImport('codex', target)))
    expect(result.secretReferenceIds).toEqual(['secret-1']); expect([...secrets.values.values()]).toEqual([literal]); expect(JSON.stringify([...assets.values.values()])).not.toContain(literal)
    const imported = [...assets.values.values()].find((asset) => asset.kind === 'mcp-server' && asset.id.endsWith('local'))!; expect(imported.metadata).toMatchObject({ envVars: ['API_KEY', 'SAFE_NAME'], secretBindings: [{ field: 'env.API_KEY', secretReferenceId: 'secret-1' }] })
  })

  it('fails closed on malformed or unsupported MCP tables', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); await writeFile(join(home, '.codex', 'config.toml'), '[mcp_servers.bad]\nenv = { KEY = dynamic() }\n')
    const instance = adapter(home).adapter; await expect(instance.inspect((await instance.detect())[0])).rejects.toThrow(/MCP|TOML|unsupported/i)
  })

  it('parses quoted server ids, nested literal headers, and portable HTTP environment references', () => {
    const parsed = parseMcpServers('[mcp_servers."remote-api"]\nurl = "https://user:pass@example.test/mcp?token=value&safe=yes"\nenv_http_headers = { X_Trace = "TRACE_ENV" }\nbearer_token_env_var = "TOKEN_ENV"\n[mcp_servers."remote-api".http_headers]\nAuthorization = "fixture-header"\n')
    expect(parsed[0].metadata).toMatchObject({ transport: 'http', bearerTokenEnvVar: 'TOKEN_ENV', envHttpHeaders: { X_Trace: 'TRACE_ENV' } }); expect(parsed[0].metadata.url).not.toContain('user:pass'); expect(parsed[0].metadata.url).not.toContain('token=')
    expect(parsed[0].literals.map((item) => item.field)).toEqual(['http_headers.Authorization', 'url.userinfo', 'url.query.token'])
  })

  it('preserves documented non-sensitive cwd, timeout, required, enabled, and tool policy fields deterministically', () => {
    const metadata = parseMcpServers('[mcp_servers.tool]\ncommand = "runner"\ncwd = "/portable/work"\nstartup_timeout_sec = 12\ntool_timeout_sec = 3.5\nenabled = true\nrequired = false\nenabled_tools = ["read", "write"]\ndisabled_tools = ["delete"]\n')[0].metadata
    expect(metadata.options).toEqual({ cwd: '/portable/work', disabled_tools: ['delete'], enabled: true, enabled_tools: ['read', 'write'], required: false, startup_timeout_sec: 12, tool_timeout_sec: 3.5 })
    const rendered = renderMcpServer('tool', metadata); expect(rendered).toContain('startup_timeout_sec = 12'); expect(rendered.indexOf('cwd =')).toBeLessThan(rendered.indexOf('startup_timeout_sec ='))
  })

  it.each([
    '[mcp_servers.bad]\ncommand = "tool"\n[mcp_servers.bad.env]\nKEY = 1\n',
    '[mcp_servers.bad]\ncommand = "tool"\nenv = { KEY = "one" }\n[mcp_servers.bad.env]\nOTHER = "two"\n',
    '[mcp_servers.bad]\ncommand = "tool"\nurl = "https://example.test"\n',
    '[mcp_servers.bad]\ncommand = "tool"\ncwd = 42\n',
  ])('fails closed for incompatible or mistyped MCP metadata', (source) => { expect(() => parseMcpServers(source)).toThrow(/MCP|TOML|type|transport|redefined|unsupported/i) })
})

describe('Codex projection', () => {
  it.each([
    { schemaVersion: 1, id: 'bad-skill', kind: 'skill', name: 'bad', files: [{ relativePath: 'README.md', bytes: new Uint8Array(), sha256: sha256(new Uint8Array()) }] },
    { schemaVersion: 1, id: 'bad-instructions', kind: 'instructions', name: 'config.toml', files: [{ relativePath: 'config.toml', bytes: new Uint8Array(), sha256: sha256(new Uint8Array()) }] },
    { schemaVersion: 1, id: 'bad-kind', kind: 'unknown', name: 'bad' },
  ] as unknown as CodexPortableAsset[])('rejects a malformed kind-specific repository asset before producing native operations', async (asset) => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home); assets.values.set(asset.id, asset); await expect(instance.planProjection({ schemaVersion: 1, assetIds: [asset.id] }, (await instance.detect())[0])).rejects.toThrow(/portable|asset|skill|instructions|kind/i)
  })

  it('rejects two selected assets that map to the same MCP server table', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home); for (const id of ['mcp-one', 'mcp-two']) assets.values.set(id, { schemaVersion: 1, id, kind: 'mcp-server', name: 'same', metadata: { transport: 'stdio', command: 'tool' } }); await expect(instance.planProjection({ schemaVersion: 1, assetIds: ['mcp-one', 'mcp-two'] }, (await instance.detect())[0])).rejects.toThrow(/duplicate|same MCP|conflict/i)
  })

  it('projects an absent skill through approved directory/file claims and rolls it back', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home)
    assets.values.set('portable-skill', { schemaVersion: 1, id: 'portable-skill', kind: 'skill', name: 'portable', files: [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode('# Portable'), sha256: sha256('# Portable') }] })
    const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') })
    const plan = await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: ['portable-skill'] }, target); expect(plan.operations.map((operation) => operation.kind)).toEqual(['create-directory', 'create'])
    const committed = await coordinator.apply(coordinator.approve(plan)); expect(await readFile(join(home, '.agents', 'skills', 'portable', 'SKILL.md'), 'utf8')).toBe('# Portable')
    await coordinator.rollback(committed.operationId); await expect(readFile(join(home, '.agents', 'skills', 'portable', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('projects sanitized MCP metadata while preserving unrelated TOML bytes and never writes literal refs', async () => {
    const home = await temporary(); const codex = join(home, '.codex'); await mkdir(codex); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const original = 'model = "keep"\n# untouched\n[mcp_servers.other]\ncommand = "other"\n'; await writeFile(join(codex, 'config.toml'), original)
    const { adapter: instance, assets } = adapter(home); assets.values.set('mcp-local', { schemaVersion: 1, id: 'mcp-local', kind: 'mcp-server', name: 'local', metadata: { transport: 'stdio', command: 'tool', envVars: ['API_KEY'], secretBindings: [{ field: 'env.API_KEY', secretReferenceId: 'secret-9' }] } })
    const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') })
    await coordinator.apply(coordinator.approve(await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: ['mcp-local'] }, target)))
    const projected = await readFile(join(codex, 'config.toml'), 'utf8'); expect(projected.startsWith(original)).toBe(true); expect(projected).toContain('env_vars = ["API_KEY"]'); expect(projected).not.toContain('secret-9')
  })

  it('fails projection closed when URL credentials have no portable environment binding', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home); assets.values.set('mcp-unsafe', { schemaVersion: 1, id: 'mcp-unsafe', kind: 'mcp-server', name: 'unsafe', metadata: { transport: 'http', url: 'https://example.test/mcp', secretBindings: [{ field: 'url.userinfo', secretReferenceId: 'secret-1' }] } })
    const target = (await instance.detect())[0]; await expect(instance.planProjection({ schemaVersion: 1, assetIds: ['mcp-unsafe'] }, target)).rejects.toThrow(/URL.*secret|binding|unresolved/i)
  })

  it('creates a previously absent config.toml without parsing the coordinator nonce claim as TOML', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home); assets.values.set('mcp-new', { schemaVersion: 1, id: 'mcp-new', kind: 'mcp-server', name: 'new', metadata: { transport: 'stdio', command: 'tool' } }); const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); await coordinator.apply(coordinator.approve(await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: ['mcp-new'] }, target))); expect(await readFile(join(home, '.codex', 'config.toml'), 'utf8')).toBe('[mcp_servers.new]\ncommand = "tool"\n')
  })

  it('falls back from clone to copy in place, reports the strategy, and preserves the coordinator claim identity', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const assets = new Assets(); const secrets = new Secrets(); assets.values.set('portable-skill', { schemaVersion: 1, id: 'portable-skill', kind: 'skill', name: 'portable', files: [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode('portable'), sha256: sha256('portable') }] })
    const instance = new CodexAdapter({ environment: { homeDirectory: home, env: {} }, assets, secrets, now: () => new Date('2026-07-15T00:00:00.000Z'), materializer: { cloneIntoClaim: async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }) }, copyIntoClaim: async (path: string, bytes: Uint8Array) => { const handle = await import('node:fs/promises').then((fs) => fs.open(path, 'r+')); try { await handle.truncate(0); await handle.writeFile(bytes) } finally { await handle.close() } } } } as never)
    const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); const result = await coordinator.apply(coordinator.approve(await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: ['portable-skill'] }, target)))
    expect(result.materializationStrategies).toEqual([{ operationId: expect.stringMatching(/^file-/), strategy: 'copy' }])
  })

  it('rejects an import when the native skill file set expands after approval', async () => {
    const home = await temporary(); const skill = join(home, '.agents', 'skills', 'portable'); await mkdir(skill, { recursive: true }); await mkdir(join(home, '.codex')); await writeFile(join(skill, 'SKILL.md'), 'approved')
    const { adapter: instance } = adapter(home); const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); const approved = coordinator.approve(await coordinator.planImport('codex', target)); await writeFile(join(skill, 'new-secret.txt'), 'unapproved')
    await expect(coordinator.apply(approved)).rejects.toThrow(/skill.*changed|approved.*file|stale/i)
  })

  it('rejects projection when an immutable repository asset changes after planning', async () => {
    const home = await temporary(); await mkdir(join(home, '.codex')); await mkdir(join(home, '.agents', 'skills'), { recursive: true }); const { adapter: instance, assets } = adapter(home); const original: CodexPortableAsset = { schemaVersion: 1, id: 'portable-skill', kind: 'skill', name: 'portable', files: [{ relativePath: 'SKILL.md', bytes: new TextEncoder().encode('approved'), sha256: sha256('approved') }] }; assets.values.set(original.id, original)
    const target = (await instance.detect())[0]; const state = join(await temporary(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot: state, coordinationRoot: state, registry: new AdapterRegistry([instance]), now: () => new Date('2026-07-15T00:01:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('codex', { schemaVersion: 1, assetIds: [original.id] }, target)); assets.values.set(original.id, { ...original, files: [...original.files!, { relativePath: 'extra.txt', bytes: new TextEncoder().encode('extra'), sha256: sha256('extra') }] })
    await expect(coordinator.apply(approved)).rejects.toThrow(/asset.*snapshot|repository.*changed|stale/i)
  })
})
