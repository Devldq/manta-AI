/**
 * Skill 技能路由 — CRUD API + 文件扫描导入 + Agent 绑定
 *
 * API 端点：
 *   GET    /api/skills              — 列表
 *   GET    /api/skills/:id          — 详情
 *   POST   /api/skills              — 创建
 *   PUT    /api/skills/:id          — 更新
 *   DELETE /api/skills/:id          — 删除
 *   PATCH  /api/skills/:id/toggle   — 启用/禁用
 *   PUT    /api/skills/:id/bind     — 绑定 Agent
 *   DELETE /api/skills/:id/bind     — 解绑 Agent
 *   GET    /api/skills/by-agent/:name  — 按 Agent 查询
 *   POST   /api/skills/scan         — 扫描 skills/ 目录
 *   POST   /api/skills/import       — 从扫描结果导入 Skill
 *   GET    /api/skills/file/:name   — 读取 SKILL.md 原始文件内容
 */

import type { FastifyInstance } from 'fastify'
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkill,
  bindAgents,
  getSkillsForAgent,
  createAndImportSkill,
} from '../core/storage/skill/store'
import {
  scanSkillFiles,
  getSkillsBaseDir,
  readSkillFileContent,
  listSkillFileTree,
  readSkillSubFile,
  writeSkillSubFile,
} from '../core/storage/skill/scanner'
import { apiSuccess, apiError, Errors } from '../core/api/error-handler'
import type { CreateSkillInput, UpdateSkillInput, SkillType, SkillMetadata } from '@manta/shared'

export async function skillRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════
  //  Skill CRUD
  // ═══════════════════════════════════════════════════════════

  // GET /api/skills — 获取 Skill 列表
  app.get('/api/skills', async (request, reply) => {
    try {
      const search = (request.query as Record<string, string>).search
      const skills = listSkills(search)
      return reply.send(apiSuccess({ skills }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/skills/:id — 获取单个 Skill
  app.get('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const skill = getSkill(id)
      if (!skill) throw Errors.NOT_FOUND('Skill', id)
      return reply.send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/skills — 创建 Skill
  app.post('/api/skills', async (request, reply) => {
    try {
      const body = request.body as Record<string, any>

      if (!body.name?.trim()) {
        throw Errors.VALIDATION_ERROR('name', 'Skill 名称不能为空')
      }
      if (!body.description?.trim()) {
        throw Errors.VALIDATION_ERROR('description', 'Skill 描述不能为空')
      }
      if (!body.type || !['writing', 'tool', 'workflow'].includes(body.type)) {
        throw Errors.VALIDATION_ERROR('type', 'Skill 类型必须为 writing、tool 或 workflow')
      }
      if (!body.content?.trim()) {
        throw Errors.VALIDATION_ERROR('content', 'Skill 指令内容不能为空')
      }

      const input: CreateSkillInput = {
        metadata: {
          name: body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          description: body.description.trim(),
          version: body.version || '1.0.0',
          type: body.type as SkillType,
          source: body.source || 'user',
          license: body.license,
          userInvocable: body.userInvocable ?? true,
          argumentHint: body.argumentHint,
        },
        content: body.content.trim(),
        parameters: body.parameters || [],
        tools: body.tools || [],
      }

      const skill = createSkill(input)
      return reply.status(201).send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/skills/:id — 更新 Skill
  app.put('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>

      const patch: UpdateSkillInput = {}
      if (body.name !== undefined || body.description !== undefined || body.type !== undefined || body.version !== undefined || body.license !== undefined || body.userInvocable !== undefined || body.argumentHint !== undefined) {
        patch.metadata = {
          ...(body.name !== undefined && { name: body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') }),
          ...(body.description !== undefined && { description: body.description.trim() }),
          ...(body.type !== undefined && { type: body.type as SkillType }),
          ...(body.version !== undefined && { version: body.version }),
          ...(body.license !== undefined && { license: body.license }),
          ...(body.userInvocable !== undefined && { userInvocable: body.userInvocable }),
          ...(body.argumentHint !== undefined && { argumentHint: body.argumentHint }),
        }
      }
      if (body.content !== undefined) patch.content = body.content
      if (body.parameters !== undefined) patch.parameters = body.parameters
      if (body.tools !== undefined) patch.tools = body.tools
      if (body.enabled !== undefined) patch.enabled = body.enabled

      const skill = updateSkill(id, patch)
      if (!skill) throw Errors.NOT_FOUND('Skill', id)
      return reply.send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/skills/:id — 删除 Skill
  app.delete('/api/skills/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const deleted = deleteSkill(id)
      if (!deleted) throw Errors.NOT_FOUND('Skill', id)
      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PATCH /api/skills/:id/toggle — 启用/禁用 Skill
  app.patch('/api/skills/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { enabled } = request.body as { enabled: boolean }

      if (typeof enabled !== 'boolean') {
        throw Errors.VALIDATION_ERROR('enabled', '必须为 boolean 类型')
      }

      const skill = toggleSkill(id, enabled)
      if (!skill) throw Errors.NOT_FOUND('Skill', id)
      return reply.send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/skills/:id/bind — 绑定 Agent 到 Skill
  app.put('/api/skills/:id/bind', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { agentNames } = request.body as { agentNames: string[] }

      if (!Array.isArray(agentNames)) {
        throw Errors.VALIDATION_ERROR('agentNames', '必须为字符串数组')
      }

      const skill = bindAgents(id, agentNames)
      if (!skill) throw Errors.NOT_FOUND('Skill', id)
      return reply.send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/skills/by-agent/:name — 按 Agent 查询 Skill
  app.get('/api/skills/by-agent/:name', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const skills = getSkillsForAgent(name)
      return reply.send(apiSuccess({ skills }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  Agent 绑定管理（解绑 + 增量绑定）
  // ═══════════════════════════════════════════════════════════

  // DELETE /api/skills/:id/bind — 解绑指定 Agent
  app.delete('/api/skills/:id/bind', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { agentName } = request.body as { agentName: string }

      if (!agentName) {
        throw Errors.VALIDATION_ERROR('agentName', '必须提供 Agent 名称')
      }

      const existing = getSkill(id)
      if (!existing) throw Errors.NOT_FOUND('Skill', id)

      const newAgents = (existing.boundAgents || []).filter((a) => a !== agentName)
      const skill = bindAgents(id, newAgents)
      return reply.send(apiSuccess({ skill }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  文件扫描 & 导入
  // ═══════════════════════════════════════════════════════════

  // POST /api/skills/scan — 扫描 skills/ 目录
  app.post('/api/skills/scan', async (request, reply) => {
    try {
      const body = request.body as Record<string, any> | undefined
      const dir = body?.dir || undefined
      const scanned = scanSkillFiles(dir)

      // 检查每个已扫描的 skill 是否已导入
      const allStored = listSkills()
      const storedNames = new Set(allStored.map((s) => s.name))

      const results = scanned.map((s) => ({
        ...s,
        alreadyImported: storedNames.has(s.name),
      }))

      return reply.send(apiSuccess({
        scanned: results,
        baseDir: dir || getSkillsBaseDir(),
        total: results.length,
        newCount: results.filter((r) => !r.alreadyImported).length,
        importedCount: results.filter((r) => r.alreadyImported).length,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/skills/import — 从扫描结果导入 Skill 到管理系统
  app.post('/api/skills/import', async (request, reply) => {
    try {
      const body = request.body as Record<string, any>
      const skillNames: string[] = body.names
      const overwrite = body.overwrite === true

      if (!Array.isArray(skillNames) || skillNames.length === 0) {
        throw Errors.VALIDATION_ERROR('names', '必须提供要导入的 Skill 名称列表')
      }

      const scanned = scanSkillFiles()
      const scannedMap = new Map(scanned.map((s) => [s.name, s]))

      const imported: any[] = []
      const skipped: string[] = []
      const errors: Array<{ name: string; error: string }> = []
      const overwritten: string[] = []

      for (const name of skillNames) {
        const scannedSkill = scannedMap.get(name)
        if (!scannedSkill) {
          errors.push({ name, error: '未在扫描结果中找到该 Skill' })
          continue
        }

        // 检查是否已存在
        const allStored = listSkills()
        const existing = allStored.find((s) => s.name === name)

        if (existing && !overwrite) {
          skipped.push(name)
          continue
        }

        if (existing && overwrite) {
          // 覆盖更新
          const patch: UpdateSkillInput = {
            metadata: {
              description: scannedSkill.description,
              version: scannedSkill.version || '1.0.0',
              type: scannedSkill.type,
              license: scannedSkill.license,
              userInvocable: scannedSkill.userInvocable ?? true,
              argumentHint: scannedSkill.argumentHint,
            },
            content: scannedSkill.content,
            tools: scannedSkill.tools,
          }
          const updated = updateSkill(existing.id, patch)
          if (updated) {
            imported.push(updated)
            overwritten.push(name)
          } else {
            errors.push({ name, error: '更新失败' })
          }
        } else {
          // 新建
          const input: CreateSkillInput = {
            metadata: {
              name: scannedSkill.name,
              description: scannedSkill.description,
              version: scannedSkill.version || '1.0.0',
              type: scannedSkill.type as SkillType,
              source: (scannedSkill.source as SkillMetadata['source']) || 'user',
              license: scannedSkill.license,
              userInvocable: scannedSkill.userInvocable ?? true,
              argumentHint: scannedSkill.argumentHint,
            },
            content: scannedSkill.content,
            tools: scannedSkill.tools,
          }
          try {
            const created = createSkill(input)
            imported.push(created)
          } catch (e) {
            errors.push({ name, error: String(e) })
          }
        }
      }

      return reply.send(apiSuccess({
        imported: imported.length,
        overwritten,
        skipped,
        errors,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/skills/file/:name — 读取 SKILL.md 原始文件内容
  app.get('/api/skills/file/:name', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const content = readSkillFileContent(name)
      if (content === null) throw Errors.NOT_FOUND('Skill 文件', name)
      return reply.send(apiSuccess({ name, content }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  动态创建 Skill（写文件 + 入库一步到位）
  // ═══════════════════════════════════════════════════════════

  // POST /api/skills/create-and-import — 动态创建并导入 Skill
  app.post('/api/skills/create-and-import', async (request, reply) => {
    try {
      const body = request.body as Record<string, any>

      if (!body.name?.trim()) throw Errors.VALIDATION_ERROR('name', 'Skill 名称不能为空')
      if (!body.description?.trim()) throw Errors.VALIDATION_ERROR('description', 'Skill 描述不能为空')
      if (!body.type || !['writing', 'tool', 'workflow'].includes(body.type)) {
        throw Errors.VALIDATION_ERROR('type', 'Skill 类型必须为 writing、tool 或 workflow')
      }
      if (!body.content?.trim()) throw Errors.VALIDATION_ERROR('content', 'Skill 指令内容不能为空')

      const result = createAndImportSkill({
        name: body.name.trim(),
        description: body.description.trim(),
        type: body.type as SkillType,
        content: body.content.trim(),
        tools: body.tools,
        version: body.version,
        license: body.license,
        argumentHint: body.argumentHint,
      })

      if (!result.success) {
        return apiError(reply, new Error(result.error || '创建失败'))
      }

      return reply.status(201).send(apiSuccess({
        skill: result.skill,
        filePath: result.filePath,
      }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  大型 Skill 文件树浏览 & 在线编辑
  // ═══════════════════════════════════════════════════════════

  // GET /api/skills/:name/files — 获取 skill 目录下的文件树
  app.get('/api/skills/:name/files', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const tree = listSkillFileTree(name)
      if (tree === null) throw Errors.NOT_FOUND('Skill', name)
      return reply.send(apiSuccess({ skillName: name, tree }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/skills/:name/files/content — 读取 skill 目录下指定文件的内容
  app.get('/api/skills/:name/files/content', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const { path: relativePath } = request.query as { path: string }
      if (!relativePath) throw Errors.VALIDATION_ERROR('path', '文件路径不能为空')

      const content = readSkillSubFile(name, relativePath)
      if (content === null) throw Errors.NOT_FOUND('文件', relativePath)
      return reply.send(apiSuccess({ skillName: name, filePath: relativePath, content }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/skills/:name/files/content — 写入 skill 目录下指定文件
  app.put('/api/skills/:name/files/content', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const { path: relativePath, content } = request.body as { path: string; content: string }
      if (!relativePath) throw Errors.VALIDATION_ERROR('path', '文件路径不能为空')
      if (typeof content !== 'string') throw Errors.VALIDATION_ERROR('content', '文件内容必须为字符串')

      const size = writeSkillSubFile(name, relativePath, content)
      if (size === null) throw Errors.INTERNAL_ERROR('文件写入失败')

      return reply.send(apiSuccess({ skillName: name, filePath: relativePath, size }))
    } catch (err) {
      return apiError(reply, err)
    }
  })
}
