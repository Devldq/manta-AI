import type { FastifyInstance } from 'fastify'
import {
  getLLMProfiles,
  getLLMProfilesMasked,
  saveLLMProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  setDefaultProfile,
  getLLMConfig,
  getActiveProfile,
} from '../core/llm/config-store'
import { testLLMConnection } from '../core/llm/factory'
import type { ModelProfile, LLMProfilesConfig } from '../core/llm/types'
import { profileToLLMConfig } from '../core/llm/types'
import { v4 as uuidv4 } from 'uuid'

export async function chatConfigRoutes(app: FastifyInstance) {
  // GET /api/chat/config — 读取多模型配置列表（脱敏）
  app.get('/api/chat/config', async (_request, reply) => {
    try {
      const data = getLLMProfilesMasked()
      return reply.send(data)
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // PUT /api/chat/config — 保存完整的多模型配置列表
  app.put('/api/chat/config', async (request, reply) => {
    try {
      const incoming = request.body as LLMProfilesConfig
      if (!incoming.profiles || incoming.profiles.length === 0) {
        return reply.status(400).send({ error: 'profiles 列表不能为空' })
      }
      const existing = getLLMProfiles()
      incoming.profiles = incoming.profiles.map((p) => {
        if (!p.apiKey?.trim()) {
          const existingProfile = existing.profiles.find((ep) => ep.id === p.id)
          if (existingProfile) return { ...p, apiKey: existingProfile.apiKey }
        }
        return p
      })
      saveLLMProfiles(incoming)
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/chat/config?action=xxx — 多种操作
  app.post('/api/chat/config', async (request, reply) => {
    try {
      const action = (request.query as Record<string, string>).action || 'test'

      if (action === 'export') {
        return reply.send(getLLMProfiles())
      }

      const body = request.body as Record<string, unknown>

      switch (action) {
        case 'test': {
          const body = request.body as { profileId?: string; config?: ModelProfile }
          let configToTest: ModelProfile
          if (body.profileId) {
            const profilesConfig = getLLMProfiles()
            const found = profilesConfig.profiles.find((p) => p.id === body.profileId)
            if (!found) return reply.status(404).send({ ok: false, error: `找不到配置: ${body.profileId}` })
            configToTest = found
          } else if (body.config) {
            configToTest = body.config
            if (!configToTest.apiKey?.trim() && configToTest.id) {
              const existing = getLLMProfiles()
              const existingProfile = existing.profiles.find((p) => p.id === configToTest.id)
              if (existingProfile) configToTest = { ...configToTest, apiKey: existingProfile.apiKey }
            }
          } else {
            configToTest = getActiveProfile()
          }
          const result = await testLLMConnection(profileToLLMConfig(configToTest))
          return reply.send(result)
        }

        case 'profile': {
          const body = request.body as { operation: 'add' | 'update' | 'delete'; profile?: ModelProfile; profileId?: string }
          switch (body.operation) {
            case 'add': {
              if (!body.profile) return reply.status(400).send({ error: '缺少 profile 数据' })
              const profileData = { ...body.profile }
              if (!profileData.apiKey?.trim()) {
                const envConfig = getLLMConfig()
                if (envConfig.apiKey && profileData.provider === envConfig.provider) {
                  profileData.apiKey = envConfig.apiKey
                }
              }
              const newProfile = addProfile(profileData)
              return reply.send({ success: true, profile: newProfile })
            }
            case 'update': {
              if (!body.profileId || !body.profile) return reply.status(400).send({ error: '缺少 profileId 或 profile 数据' })
              const updated = updateProfile(body.profileId, body.profile)
              return reply.send({ success: true, profile: updated })
            }
            case 'delete': {
              if (!body.profileId) return reply.status(400).send({ error: '缺少 profileId' })
              deleteProfile(body.profileId)
              return reply.send({ success: true })
            }
            default:
              return reply.status(400).send({ error: `不支持的操作: ${body.operation}` })
          }
        }

        case 'active': {
          const body = request.body as { profileId: string }
          if (!body.profileId) return reply.status(400).send({ error: '缺少 profileId' })
          setActiveProfile(body.profileId)
          return reply.send({ success: true })
        }

        case 'default': {
          const body = request.body as { profileId: string }
          if (!body.profileId) return reply.status(400).send({ error: '缺少 profileId' })
          setDefaultProfile(body.profileId)
          return reply.send({ success: true })
        }

        case 'import': {
          const body = request.body as { profiles: ModelProfile[]; merge?: boolean }
          const { profiles: incomingProfiles, merge = true } = body
          if (!incomingProfiles || !Array.isArray(incomingProfiles) || incomingProfiles.length === 0) {
            return reply.status(400).send({ error: 'profiles 列表不能为空' })
          }
          for (const p of incomingProfiles) {
            if (!p.name || !p.provider || !p.model) {
              return reply.status(400).send({ error: '每个配置必须包含 name、provider 和 model 字段' })
            }
          }
          const existing = getLLMProfiles()
          if (merge) {
            const existingIds = new Set(existing.profiles.map(p => p.id))
            let addedCount = 0
            let skippedCount = 0
            for (const p of incomingProfiles) {
              if (existingIds.has(p.id)) { skippedCount++; continue }
              existing.profiles.push({ ...p, id: p.id || uuidv4() })
              addedCount++
            }
            if (!existing.activeProfileId && existing.profiles.length > 0) {
              existing.activeProfileId = existing.profiles[0].id
            }
            saveLLMProfiles(existing)
            return reply.send({ success: true, added: addedCount, skipped: skippedCount, total: existing.profiles.length })
          } else {
            const profilesWithIds = incomingProfiles.map(p => ({ ...p, id: p.id || uuidv4() }))
            const newConfig: LLMProfilesConfig = { profiles: profilesWithIds, activeProfileId: profilesWithIds[0]?.id }
            saveLLMProfiles(newConfig)
            return reply.send({ success: true, added: profilesWithIds.length, skipped: 0, total: profilesWithIds.length })
          }
        }

        default:
          return reply.status(400).send({ error: `不支持的操作: ${action}` })
      }
    } catch (err) {
      return reply.status(500).send({ ok: false, error: String(err) })
    }
  })
}
