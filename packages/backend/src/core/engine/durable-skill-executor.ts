import { randomBytes } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { SkillRunPayloadSchema, type JsonValue } from '@manta/contracts'
import { SkillRuntime } from '@manta/skill-runtime'
import type { JobExecutorRegistration } from '@manta/task-runtime'
import type { LocalAccessToken } from '../../local-access.js'
import { getSkill } from '../storage/skill/store.js'
import { validateSkillPackagePath } from '../../storage/skill-package-import.js'

const ALLOWED_MANTA_SCOPES = new Set([
  'knowledge:read', 'knowledge:write', 'jobs:read', 'jobs:write',
  'skills:read', 'skills:run', 'agents:run', 'manta:read', 'manta:write',
])

export interface DurableSkillExecutorOptions {
  extensionsRoot: string
  grantsPath: string
  tokens?: LocalAccessToken[]
  endpoint(): string | undefined
}

export function createSkillRunExecutor(options: DurableSkillExecutorOptions): JobExecutorRegistration {
  const skillRuntime = new SkillRuntime({ grantsPath: options.grantsPath })
  return {
    kind: 'skill.run',
    interruption: 'manual-recovery',
    async execute(context) {
      const payload = SkillRunPayloadSchema.parse(context.job.payload)
      const directory = resolveSkillDirectory(options.extensionsRoot, payload.skillId)
      const loaded = await skillRuntime.inspect(payload.skillId, directory)
      context.checkpoint('skill_loaded', { skillId: payload.skillId, digest: loaded.digest, runtime: loaded.manifest?.runtime ?? 'prompt' })
      const requestedScopes = loaded.manifest?.permissions.manta ?? []
      const invalidScopes = requestedScopes.filter((scope) => !ALLOWED_MANTA_SCOPES.has(scope))
      if (invalidScopes.length) throw new Error(`Skill requested unsupported Manta scopes: ${invalidScopes.join(', ')}`)
      const access = requestedScopes.length ? issueScopedToken(options, requestedScopes) : undefined
      try {
        context.emit('log', { channel: 'skill.audit', event: 'started', skillId: payload.skillId, digest: loaded.digest, permissions: loaded.requiredPermissions })
        const result = await skillRuntime.run({
          skillId: payload.skillId,
          directory,
          input: payload.input,
          signal: context.signal,
          ...(access ? { manta: { baseURL: access.endpoint, apiKey: access.token } } : {}),
        })
        context.emit('log', { channel: 'skill.audit', event: 'completed', skillId: payload.skillId, digest: result.digest, durationMs: result.durationMs, stderr: result.stderr ?? null })
        context.addArtifact({
          kind: 'skill.result',
          mediaType: 'application/json',
          name: `${payload.skillId}-result`,
          uri: `manta://skills/${encodeURIComponent(payload.skillId)}/jobs/${context.job.id}`,
          metadata: { skillId: payload.skillId, digest: result.digest, mode: result.mode },
        })
        return result as unknown as JsonValue
      } finally {
        access?.revoke()
      }
    },
  }
}

export function resolveSkillDirectory(extensionsRoot: string, skillId: string): string {
  const skill = getSkill(skillId)
  if (!skill || !skill.enabled) throw new Error(`Skill ${skillId} was not found or is disabled`)
  const directory = skill.packagePath
    ? resolve(extensionsRoot, ...validateSkillPackagePath(skill.packagePath).split('/'))
    : resolve(extensionsRoot, 'skills', skill.metadata.name)
  const rel = relative(resolve(extensionsRoot), directory)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Skill package resolves outside extensions storage')
  return directory
}

function issueScopedToken(options: DurableSkillExecutorOptions, scopes: string[]): { endpoint: string; token: string; revoke(): void } {
  const endpoint = options.endpoint()
  if (!endpoint || !options.tokens) throw new Error('Scoped local Manta access is unavailable')
  const token = randomBytes(32).toString('base64url')
  const record = { token, scopes: [...new Set(scopes)] }
  options.tokens.push(record)
  let revoked = false
  return {
    endpoint,
    token,
    revoke() {
      if (revoked) return
      revoked = true
      const index = options.tokens!.indexOf(record)
      if (index >= 0) options.tokens!.splice(index, 1)
    },
  }
}
