import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLocalCachePath, resolveStoragePath, runWithStorageResolver, safeStorageSegment } from './path-routing'

describe('ASH persistence routing', () => {
  it.each(['CON.txt', 'COM1', 'NUL', 'name.', 'name ', 'name:', '.', '..', 'a/b', 'a\\b', 'bad\u0001'])('rejects non-portable storage segment %j', (value) => {
    expect(() => safeStorageSegment(value)).toThrow(/unsafe/i)
  })
  it('requires an injected resolver instead of silently falling back', () => {
    expect(() => resolveStoragePath('work', 'sessions')).toThrow(/storage resolver/i)
  })

  it('routes each internal group below the injected ASH root', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-routing-'))
    const resolver = { resolve: (group: string, ...segments: string[]) => join(root, group, ...segments) }
    runWithStorageResolver(resolver, () => {
      expect(resolveStoragePath('extensions', 'plugins')).toBe(join(root, 'extensions', 'plugins'))
      expect(resolveStoragePath('knowledge', 'rag')).toBe(join(root, 'knowledge', 'rag'))
      expect(resolveStoragePath('work', 'conversations')).toBe(join(root, 'work', 'conversations'))
      expect(resolveStoragePath('config', 'llm-profiles.json')).toBe(join(root, 'config', 'llm-profiles.json'))
      expect(resolveStoragePath('secrets', 'mcp-oauth')).toBe(join(root, 'secrets', 'mcp-oauth'))
      expect(resolveStoragePath('diagnostics', 'audit.log')).toBe(join(root, 'diagnostics', 'audit.log'))
      expect(resolveStoragePath('cache', 'uploads')).toBe(join(root, 'cache', 'uploads'))
    })
  })

  it('keeps machine-local cache outside routed storage when explicitly configured', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-routing-'))
    const local = mkdtempSync(join(tmpdir(), 'manta-local-cache-'))
    runWithStorageResolver({
      resolve: (group, ...segments) => join(root, group, ...segments),
      resolveLocalCache: (...segments) => join(local, ...segments),
    }, () => {
      expect(resolveLocalCachePath('conversation-indexes', 'global.json'))
        .toBe(join(local, 'conversation-indexes', 'global.json'))
    })
  })

  it('keeps an explicit user output path unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-internal-'))
    const workspace = mkdtempSync(join(tmpdir(), 'manta-user-output-'))
    const output = join(workspace, 'chosen.txt')
    const { createFileOpsTools } = await import('../core/tools/builtin/file-ops')
    const { runWithSecurityContext } = await import('../core/security-context')
    await runWithStorageResolver({ resolve: (group, ...segments) => join(root, group, ...segments) }, async () => {
      await runWithSecurityContext({ allowedRoots: [workspace], shellAllowedRoots: [workspace], platform: process.platform, allowExternalWrite: true }, async () => {
        const write = createFileOpsTools().find((tool) => tool.name === 'write')
        expect(write).toBeDefined()
        const result = await write!.execute({ file_path: output, content: 'user-owned' })
        expect(result).toMatchObject({ success: true })
      })
    })
    expect(existsSync(output)).toBe(true)
    expect(readFileSync(output, 'utf8')).toBe('user-owned')
  })

  it.each([
    ['auto', true],
    ['full', true],
    ['request', false],
  ] as const)('enforces %s approval mode for writes outside the workspace', async (approvalMode, expectedSuccess) => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-policy-'))
    const workspace = mkdtempSync(join(tmpdir(), 'manta-policy-workspace-'))
    const external = join(mkdtempSync(join(tmpdir(), 'manta-policy-external-')), 'outside.txt')
    const { createFileOpsTools } = await import('../core/tools/builtin/file-ops')
    const { runWithSecurityContext } = await import('../core/security-context')
    let approvalRequests = 0
    const result = await runWithStorageResolver({ resolve: (group, ...segments) => join(root, group, ...segments) }, () =>
      runWithSecurityContext({
        allowedRoots: [workspace],
        shellAllowedRoots: [workspace],
        platform: process.platform,
        allowExternalRead: true,
        allowExternalWrite: true,
        approvalMode,
        onApprovalRequest: async () => {
          approvalRequests += 1
          return false
        },
      }, async () => {
        const write = createFileOpsTools().find((tool) => tool.name === 'write')!
        return write.execute({ file_path: external, content: approvalMode })
      }),
    ) as Record<string, unknown>

    expect('success' in result).toBe(expectedSuccess)
    expect(existsSync(external)).toBe(expectedSuccess)
    expect(approvalRequests).toBe(approvalMode === 'request' ? 1 : 0)
  })

  it('stores API keys only in the secrets group', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-secrets-'))
    const resolver = { resolve: (group: string, ...segments: string[]) => join(root, group, ...segments) }
    const { saveLLMProfiles } = await import('../core/llm/config-store')
    const { saveEmbeddingConfig } = await import('../core/engine/rag/embedding-config-store')
    const { saveUserServer } = await import('../core/tools/mcp/config-store')
    runWithStorageResolver(resolver, () => {
      saveLLMProfiles({ activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'test', provider: 'openai-compatible', model: 'm', apiKey: 'llm-secret' }] })
      saveEmbeddingConfig({ provider: 'openai', model: 'embed', apiKey: 'embedding-secret' })
      saveUserServer({ name: 'private-api', description: 'test', config: { type: 'remote', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer mcp-secret' } } })
    })
    expect(readFileSync(join(root, 'config', 'llm-profiles.json'), 'utf8')).not.toContain('llm-secret')
    expect(readFileSync(join(root, 'config', 'embedding-config.json'), 'utf8')).not.toContain('embedding-secret')
    expect(readFileSync(join(root, 'secrets', 'llm-profile-api-keys.json'), 'utf8')).toContain('llm-secret')
    expect(readFileSync(join(root, 'secrets', 'embedding-api-key.json'), 'utf8')).toContain('embedding-secret')
    expect(readFileSync(join(root, 'config', 'mcp', 'servers.json'), 'utf8')).not.toContain('mcp-secret')
    expect(readFileSync(join(root, 'secrets', 'mcp', 'server-secrets.json'), 'utf8')).toContain('mcp-secret')
  })

  it('does not let generated Skill files escape the extensions group', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-skill-path-'))
    const { writeSkillSubFile } = await import('../core/storage/skill/scanner')
    const result = runWithStorageResolver({ resolve: (group, ...segments) => join(root, group, ...segments) }, () =>
      writeSkillSubFile('safe', '../safe-escape/payload.txt', 'escape'),
    )
    expect(result).toBeNull()
    expect(existsSync(join(root, 'extensions', 'skills', 'safe-escape', 'payload.txt'))).toBe(false)
  })

  it('preserves omitted secrets and removes them only through explicit clear semantics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-ash-secret-patch-')); const resolver = { resolve: (group: string, ...segments: string[]) => join(root, group, ...segments) }
    const llm = await import('../core/llm/config-store'); const embedding = await import('../core/engine/rag/embedding-config-store'); const mcp = await import('../core/tools/mcp/config-store'); const kb = await import('../core/storage/knowledge-base/store')
    runWithStorageResolver(resolver, () => {
      llm.saveLLMProfiles({ profiles: [{ id: 'p', name: 'P', provider: 'openai-compatible', model: 'm1', apiKey: 'llm-key' }] })
      llm.saveLLMProfiles({ profiles: [{ id: 'p', name: 'P', provider: 'openai-compatible', model: 'm2' }] })
      expect(llm.getLLMProfiles().profiles[0].apiKey).toBe('llm-key')
      llm.saveLLMProfiles({ profiles: [{ id: 'p', name: 'P', provider: 'openai-compatible', model: 'm2', clearApiKey: true } as never] }); expect(llm.getLLMProfiles().profiles[0].apiKey).toBeUndefined()
      embedding.saveEmbeddingConfig({ provider: 'openai', model: 'e1', apiKey: 'embed-key' }); embedding.saveEmbeddingConfig({ provider: 'openai', model: 'e2' }); expect(embedding.getEmbeddingConfig().apiKey).toBe('embed-key'); embedding.saveEmbeddingConfig({ provider: 'openai', model: 'e2', clearApiKey: true }); expect(embedding.getEmbeddingConfig().apiKey).not.toBe('embed-key')
      mcp.saveUserServer({ name: 'm', description: 'M', config: { type: 'remote', url: 'https://one', headers: { Authorization: 'mcp-key' } } }); mcp.saveUserServer({ name: 'm', description: 'M2', config: { type: 'remote', url: 'https://two' } }); expect((mcp.getUserServer('m')!.config as { headers?: Record<string, string> }).headers?.Authorization).toBe('mcp-key'); mcp.saveUserServer({ name: 'm', description: 'M2', config: { type: 'remote', url: 'https://two' }, clearSecrets: { headers: ['Authorization'] } } as never); expect((mcp.getUserServer('m')!.config as { headers?: Record<string, string> }).headers?.Authorization).toBeUndefined()
      const created = kb.createKnowledgeBase({ name: 'KB', config: { embeddingConfig: { provider: 'openai', apiKey: 'kb-key' } } }); kb.updateKnowledgeBase(created.id, { description: 'changed' }); expect(kb.getKnowledgeBase(created.id)!.config.embeddingConfig?.apiKey).toBe('kb-key'); kb.updateKnowledgeBase(created.id, { clearEmbeddingApiKey: true }); expect(kb.getKnowledgeBase(created.id)!.config.embeddingConfig?.apiKey).toBeUndefined()
    })
  })
})
