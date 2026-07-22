import type { FastifyPluginAsync } from 'fastify'
import type { TaskRuntime } from '@manta/task-runtime'
import { JsonValueSchema } from '@manta/contracts'
import { SkillRuntime, SkillRuntimeError } from '@manta/skill-runtime'
import { z } from 'zod'
import { listSkills } from '../core/storage/skill/store.js'
import { resolveSkillDirectory } from '../core/engine/durable-skill-executor.js'

export interface SkillV1RoutesOptions {
  runtime: TaskRuntime
  extensionsRoot: string
  grantsPath: string
}

const RunSchema = z.object({ input: JsonValueSchema.default({}) })
const AuthorizationSchema = z.object({ permissions: z.array(z.string().min(1)).default([]) })

export const skillV1Routes: FastifyPluginAsync<SkillV1RoutesOptions> = async (app, options) => {
  const runtime = new SkillRuntime({ grantsPath: options.grantsPath })

  app.get('/v1/skills', async (_request, reply) => {
    const values = []
    for (const skill of listSkills()) {
      try {
        const loaded = await runtime.inspect(skill.id, resolveSkillDirectory(options.extensionsRoot, skill.id))
        values.push({ ...skill, script: Boolean(loaded.manifest), runtime: loaded.manifest?.runtime, digest: loaded.digest, requiredPermissions: loaded.requiredPermissions, authorized: loaded.authorized })
      } catch (error) {
        values.push({ ...skill, script: false, authorized: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return reply.send({ data: values })
  })

  app.get('/v1/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const loaded = await runtime.inspect(id, resolveSkillDirectory(options.extensionsRoot, id))
      return reply.send({ data: { skillId: id, digest: loaded.digest, prompt: loaded.prompt, manifest: loaded.manifest, requiredPermissions: loaded.requiredPermissions, authorized: loaded.authorized, grant: loaded.grant } })
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/v1/skills/:id/authorization', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const input = AuthorizationSchema.parse(request.body)
      const grant = await runtime.authorize(id, resolveSkillDirectory(options.extensionsRoot, id), input.permissions)
      return reply.send({ data: grant })
    } catch (error) { return sendError(reply, error) }
  })

  app.delete('/v1/skills/:id/authorization', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send({ data: { revoked: await runtime.revoke(id) } })
  })

  app.post('/v1/skills/:id/runs', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const input = RunSchema.parse(request.body ?? {})
      const loaded = await runtime.inspect(id, resolveSkillDirectory(options.extensionsRoot, id))
      if (loaded.manifest && !loaded.authorized) {
        throw new SkillRuntimeError('SKILL_AUTHORIZATION_REQUIRED', `Skill ${id} requires authorization for its current content digest`, { digest: loaded.digest, requiredPermissions: loaded.requiredPermissions })
      }
      const job = options.runtime.createJob({
        kind: 'skill.run',
        payload: { skillId: id, input: input.input, grantedPermissions: [] },
        metadata: { skillId: id },
        maxAttempts: 1,
        idempotencyKey: header(request.headers['idempotency-key']),
      })
      return reply.status(202).header('location', `/v1/jobs/${job.id}`).send({ data: job })
    } catch (error) { return sendError(reply, error) }
  })
}

function sendError(reply: any, error: unknown) {
  const status = error instanceof z.ZodError ? 400 : error instanceof SkillRuntimeError && error.code === 'SKILL_AUTHORIZATION_REQUIRED' ? 403 : 400
  const code = error instanceof SkillRuntimeError ? error.code : error instanceof z.ZodError ? 'INVALID_REQUEST' : 'SKILL_ERROR'
  return reply.status(status).send({ error: { code, message: error instanceof Error ? error.message : String(error), ...(error instanceof SkillRuntimeError && error.details ? { details: error.details } : {}) } })
}

function header(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }
