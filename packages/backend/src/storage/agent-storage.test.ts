import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AshCodexPortableAssetRepository, AshCodexSecretRepository, createAgentStorageComposition } from './agent-storage'

async function roots() {
  const root = await mkdtemp(join(tmpdir(), 'manta-agent-storage-'))
  const volume = join(root, '.manta-ai')
  const extensions = join(volume, 'extensions')
  const secrets = join(volume, 'secrets')
  await mkdir(extensions, { recursive: true }); await mkdir(secrets, { recursive: true })
  return { volume, extensions, secrets }
}

describe('ASH Codex portable asset repository', () => {
  it('persists immutable assets and reuses duplicate file content through volume-local CAS', async () => {
    const { volume, extensions } = await roots()
    const repository = new AshCodexPortableAssetRepository(extensions)
    const bytes = new TextEncoder().encode('portable content')
    const first = { schemaVersion: 1 as const, id: 'skill-one', kind: 'skill' as const, name: 'one', files: [{ relativePath: 'SKILL.md', bytes, sha256: 'b980f960c92a64b2d7565bb5513f00bcf18d71d9e9c7c16fb1f1b3e0a6e4b3cc' }] }
    first.files[0]!.sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    await repository.import(first)
    await repository.import({ ...first, id: 'skill-two', name: 'two' })

    await expect(new AshCodexPortableAssetRepository(extensions).read('skill-one')).resolves.toEqual(first)
    await expect(repository.list()).resolves.toEqual([
      { schemaVersion: 1, id: 'skill-one', kind: 'skill' },
      { schemaVersion: 1, id: 'skill-two', kind: 'skill' },
    ])
    const objectFiles = await import('node:fs/promises').then(({ readdir }) => readdir(join(volume, '.ash', 'objects', 'sha256', first.files[0]!.sha256.slice(0, 2))))
    expect(objectFiles).toEqual([first.files[0]!.sha256])
  })

  it('is idempotent for identical imports and rejects an immutable id collision', async () => {
    const { extensions } = await roots(); const repository = new AshCodexPortableAssetRepository(extensions)
    const bytes = new TextEncoder().encode('same'); const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    const asset = { schemaVersion: 1 as const, id: 'instructions', kind: 'instructions' as const, name: 'AGENTS.md', files: [{ relativePath: 'AGENTS.md', bytes, sha256 }] }
    const first = await repository.import(asset)
    await expect(repository.import(asset)).resolves.toEqual(first)
    await expect(repository.import({ ...asset, name: 'AGENTS.override.md' })).rejects.toThrow(/collision/i)
  })

  it('supports maximum-length ids and concurrent identical retries', async () => {
    const { extensions } = await roots(); const repository = new AshCodexPortableAssetRepository(extensions)
    const bytes = new TextEncoder().encode('concurrent'); const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    const asset = { schemaVersion: 1 as const, id: `a${'b'.repeat(127)}`, kind: 'instructions' as const, name: 'AGENTS.md', files: [{ relativePath: 'AGENTS.md', bytes, sha256 }] }
    await expect(Promise.all([repository.import(asset), repository.import(asset)])).resolves.toEqual([expect.objectContaining({ id: asset.id }), expect.objectContaining({ id: asset.id })])
  })

  it('fails closed when a referenced CAS object is corrupt', async () => {
    const { volume, extensions } = await roots(); const repository = new AshCodexPortableAssetRepository(extensions)
    const bytes = new TextEncoder().encode('verified'); const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    await repository.import({ schemaVersion: 1, id: 'asset', kind: 'instructions', name: 'AGENTS.md', files: [{ relativePath: 'AGENTS.md', bytes, sha256 }] })
    await writeFile(join(volume, '.ash', 'objects', 'sha256', sha256.slice(0, 2), sha256), 'corrupt')
    await expect(repository.read('asset')).rejects.toThrow(/integrity|hash/i)
  })

  it('fails closed when a descriptor leaf is replaced by a symbolic link', async () => {
    const { extensions } = await roots(); const repository = new AshCodexPortableAssetRepository(extensions)
    await repository.import({ schemaVersion: 1, id: 'linked', kind: 'mcp-server', name: 'linked', metadata: {} })
    const descriptor = join(extensions, 'agent-assets', 'linked.json'); const outside = join(extensions, '..', 'outside-descriptor.json'); await writeFile(outside, await readFile(descriptor)); await rm(descriptor)
    try { await symlink(outside, descriptor, 'file') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    await expect(repository.read('linked')).rejects.toThrow(/ordinary|linked|symbolic/i)
  })

  it('fails closed when a descriptor leaf is not an ordinary file', async () => {
    const { extensions } = await roots(); const repository = new AshCodexPortableAssetRepository(extensions); const descriptor = join(extensions, 'agent-assets', 'directory.json'); await mkdir(descriptor, { recursive: true })
    await expect(repository.read('directory')).rejects.toThrow(/ordinary/i)
  })
})

describe('ASH Codex secret repository', () => {
  it('returns opaque non-content-derived references and writes exclusive private files below secrets', async () => {
    const { secrets } = await roots(); const repository = new AshCodexSecretRepository(secrets)
    const value = `sensitive-${crypto.randomUUID()}`
    const first = await repository.storeLiteral({ value, purpose: 'integration-field' })
    const second = await repository.storeLiteral({ value, purpose: 'integration-field' })
    expect(first).not.toBe(second); expect(first).not.toContain(value); expect(second).not.toContain(value)
    const path = join(secrets, 'agent-secrets', `${first}.json`)
    await expect(access(path)).resolves.toBeUndefined()
    expect(await readFile(path, 'utf8')).toContain(value)
  })

  it('fails closed when the secret directory is a symbolic link', async () => {
    const { secrets } = await roots(); const outside = join(secrets, '..', 'outside'); await mkdir(outside)
    try { await symlink(outside, join(secrets, 'agent-secrets'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return; throw error }
    await expect(new AshCodexSecretRepository(secrets).storeLiteral({ value: `s-${crypto.randomUUID()}`, purpose: 'field' })).rejects.toThrow(/linked|symbolic/i)
  })
})

describe('Agent storage composition', () => {
  it('detects, previews one-use import/projection, applies through the coordinator, and rolls back', async () => {
    const { volume, extensions, secrets } = await roots(); const home = join(volume, 'home')
    const codexHome = join(home, '.codex'); const skillRoot = join(home, '.agents', 'skills'); const nativeSkill = join(skillRoot, 'demo')
    await mkdir(codexHome, { recursive: true }); await mkdir(nativeSkill, { recursive: true }); await writeFile(join(nativeSkill, 'SKILL.md'), 'portable skill')
    const progress: unknown[] = []
    const composition = await createAgentStorageComposition({
      resolve: (group, ...segments) => join(group === 'extensions' ? extensions : group === 'secrets' ? secrets : join(volume, group), ...segments),
      homeDirectory: home,
      environment: {},
      onProgress: (value) => progress.push(value),
    })
    expect((await composition.readModel.agents()).adapters[0]?.installations[0]?.id).toBe('codex-user')
    const preview = await composition.mutations.previewImport('codex', 'codex-user', 'sender-1')
    expect(preview.operations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'read', nativePath: join(nativeSkill, 'SKILL.md') })]))
    const imported = await composition.mutations.apply(preview.planSessionId, 'sender-1')
    expect(imported.result).toEqual(expect.objectContaining({ status: 'committed', verified: true }))
    await expect(composition.mutations.apply(preview.planSessionId, 'sender-1')).rejects.toThrow(/session/i)
    expect((await composition.readModel.assets('codex', 'codex-user')).portableAssets).toContainEqual(expect.objectContaining({ id: 'codex-skill-demo' }))

    await rm(nativeSkill, { recursive: true })
    const projection = await composition.mutations.previewProjection('codex', 'codex-user', ['codex-skill-demo'], 'sender-1')
    const projected = await composition.mutations.apply(projection.planSessionId, 'sender-1')
    await expect(readFile(join(nativeSkill, 'SKILL.md'), 'utf8')).resolves.toBe('portable skill')
    const restarted = await createAgentStorageComposition({ resolve: (group, ...segments) => join(group === 'extensions' ? extensions : group === 'secrets' ? secrets : join(volume, group), ...segments), homeDirectory: home, environment: {} })
    await expect(restarted.readModel.operation(projected.operationId)).resolves.toEqual(expect.objectContaining({ status: 'committed', verified: true }))
    await expect(restarted.mutations.rollback(projected.operationId)).resolves.toEqual(expect.objectContaining({ status: 'rolled-back', verified: true }))
    await expect(access(nativeSkill)).rejects.toThrow()
    expect(progress).toEqual(expect.arrayContaining([expect.objectContaining({ operationId: projected.operationId, phase: 'completed', status: 'completed' })]))
    expect(await composition.readModel.reuse()).toEqual(expect.objectContaining({ scanStatus: 'complete', portableAssetCount: 1, logicalImmutableBytes: 14, uniqueVerifiedObjectBytes: 14, verifiedSavedBytes: 0 }))
  })

  it('does not let a foreign sender consume a session and caps expiry to the configured TTL', async () => {
    const { volume, extensions, secrets } = await roots(); const home = join(volume, 'home'); await mkdir(join(home, '.codex'), { recursive: true }); await mkdir(join(home, '.agents', 'skills'), { recursive: true })
    let now = new Date('2026-07-15T00:00:00.000Z')
    const composition = await createAgentStorageComposition({ resolve: (group, ...segments) => join(group === 'extensions' ? extensions : group === 'secrets' ? secrets : join(volume, group), ...segments), homeDirectory: home, environment: {}, now: () => now, sessionTtlMs: 1_000 })
    const preview = await composition.mutations.previewImport('codex', 'codex-user', 'owner')
    expect(preview.expiresAt).toBe('2026-07-15T00:00:01.000Z')
    await expect(composition.mutations.apply(preview.planSessionId, 'foreign')).rejects.toThrow(/foreign/i)
    await expect(composition.mutations.apply(preview.planSessionId, 'owner')).resolves.toEqual(expect.objectContaining({ operationId: expect.any(String) }))
    const expired = await composition.mutations.previewImport('codex', 'codex-user', 'owner'); now = new Date('2026-07-15T00:00:02.000Z')
    await expect(composition.mutations.apply(expired.planSessionId, 'owner')).rejects.toThrow(/expired/i)
  })

  it('reports detection failures as structured unavailable state', async () => {
    const { volume, extensions, secrets } = await roots(); const home = join(volume, 'missing-home')
    const composition = await createAgentStorageComposition({ resolve: (group, ...segments) => join(group === 'extensions' ? extensions : group === 'secrets' ? secrets : join(volume, group), ...segments), homeDirectory: home, environment: {} })
    await expect(composition.readModel.agents()).resolves.toEqual({ adapters: [expect.objectContaining({ id: 'codex', status: 'error', installations: [], error: expect.objectContaining({ code: 'AGENT_DETECTION_FAILED' }) })], operations: [] })
  })
})
