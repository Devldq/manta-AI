/**
 * Plugin 插件路由 — 完整 CRUD + 生命周期管理 API
 *
 * API 端点：
 *   GET    /api/plugins                    — 插件列表
 *   GET    /api/plugins/:id                — 插件详情
 *   POST   /api/plugins/install            — 安装插件（从本地目录或 npm）
 *   DELETE /api/plugins/:id                — 卸载插件
 *   PUT    /api/plugins/:id                — 更新插件
 *   PATCH  /api/plugins/:id/toggle         — 启用/禁用插件
 *   POST   /api/plugins/:id/activate       — 激活插件
 *   POST   /api/plugins/:id/deactivate     — 停用插件
 *   POST   /api/plugins/scan               — 扫描插件目录
 *   POST   /api/plugins/register           — 从扫描结果注册插件
 *   POST   /api/plugins/:id/hooks/:event   — 手动触发钩子
 *   GET    /api/plugins/registry           — 注册表摘要信息
 *   POST   /api/plugins/install-file       — 从目录安装插件
 */

import type { FastifyInstance } from 'fastify'
import * as fs from 'fs'
import * as path from 'path'
import {
  listPlugins,
  getPlugin,
  installPlugin,
  deletePlugin,
  updatePlugin,
  enablePlugin as storeEnable,
  disablePlugin as storeDisable,
  getPluginsSourceDir,
  findPluginByManifestId,
} from '../core/storage/plugin/store'
import {
  scanPluginFiles,
  readPluginYamlContent,
  copyPluginDir,
  validatePluginManifest,
  getPluginsBaseDir,
} from '../core/storage/plugin/scanner'
import { pluginRegistry } from '../core/storage/plugin/registry'
import { apiSuccess, apiError, Errors } from '../core/api/error-handler'
import type {
  PluginHookEvent,
  InstallPluginInput,
  UpdatePluginInput,
} from '@manta/shared'

// 内置插件 ID（禁止卸载）
const BUILTIN_PLUGIN_IDS = new Set<string>()

export async function pluginRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════
  //  Plugin CRUD
  // ═══════════════════════════════════════════════════════════

  // GET /api/plugins — 获取插件列表
  app.get('/api/plugins', async (request, reply) => {
    try {
      const search = (request.query as Record<string, string>).search
      const plugins = listPlugins(search)
      return reply.send(apiSuccess({ plugins }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/plugins/registry — 获取注册表摘要
  app.get('/api/plugins/registry', async (_request, reply) => {
    try {
      const summary = pluginRegistry.getSummary()
      return reply.send(apiSuccess(summary))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // GET /api/plugins/:id — 获取单个插件详情
  app.get('/api/plugins/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const plugin = getPlugin(id)
      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)
      return reply.send(apiSuccess({ plugin }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // PUT /api/plugins/:id — 更新插件
  app.put('/api/plugins/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const body = request.body as Record<string, any>

      const input: UpdatePluginInput = {}
      if (body.state) input.state = body.state
      if (body.manifest) input.manifest = body.manifest

      const plugin = updatePlugin(id, input)
      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)
      return reply.send(apiSuccess({ plugin }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // DELETE /api/plugins/:id — 卸载插件
  app.delete('/api/plugins/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }

      if (BUILTIN_PLUGIN_IDS.has(id)) {
        throw Errors.FORBIDDEN('内置插件不允许卸载')
      }

      const plugin = getPlugin(id)
      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)

      // 执行卸载前清理
      await pluginRegistry.onPreUninstall(id)

      // 删除插件目录
      const pluginDir = path.join(getPluginsSourceDir(), plugin.manifest.id)
      if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true })
      }

      const deleted = deletePlugin(id)
      if (!deleted) throw Errors.NOT_FOUND('Plugin', id)

      return reply.send(apiSuccess({ success: true }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  Plugin 安装
  // ═══════════════════════════════════════════════════════════

  // POST /api/plugins/install-file — 从本地目录安装插件
  app.post('/api/plugins/install-file', async (request, reply) => {
    try {
      const body = request.body as { sourcePath?: string }
      let sourcePath = (body.sourcePath ?? '').trim()

      if (!sourcePath) {
        throw Errors.VALIDATION_ERROR('sourcePath', '插件路径不能为空')
      }

      // 展开 ~
      if (sourcePath.startsWith('~/')) {
        sourcePath = path.join(
          process.env.HOME ?? process.env.USERPROFILE ?? '',
          sourcePath.slice(2),
        )
      }

      const resolvedSource = path.resolve(sourcePath)
      if (!fs.existsSync(resolvedSource)) {
        throw Errors.VALIDATION_ERROR('sourcePath', `路径不存在: ${resolvedSource}`)
      }
      if (!fs.statSync(resolvedSource).isDirectory()) {
        throw Errors.VALIDATION_ERROR('sourcePath', '路径必须是一个目录')
      }

      // 扫描源目录，读取 plugin.yaml
      const scanned = scanPluginFiles(resolvedSource)

      // 如果源目录本身就有 plugin.yaml
      let manifest = scanned.find((s) => s.dirPath === resolvedSource)?.manifest

      // 如果没找到，尝试直接读取
      if (!manifest) {
        const directYaml = path.join(resolvedSource, 'plugin.yaml')
        if (!fs.existsSync(directYaml)) {
          throw Errors.VALIDATION_ERROR(
            'sourcePath',
            '该目录没有 plugin.yaml，不是合法的 Manta 插件',
          )
        }
        // 直接扫描该目录
        const results = scanPluginFiles(
          path.resolve(resolvedSource, '..'),
        )
        manifest = results.find(
          (s) =>
            s.dirPath === resolvedSource ||
            s.manifest.id === path.basename(resolvedSource),
        )?.manifest
      }

      if (!manifest) {
        throw Errors.VALIDATION_ERROR(
          'sourcePath',
          '无法解析 plugin.yaml，不是合法的 Manta 插件',
        )
      }

      // 验证 manifest
      const validation = validatePluginManifest(manifest)
      if (!validation.valid) {
        throw Errors.VALIDATION_ERROR(
          'manifest',
          validation.errors.join('; '),
        )
      }

      // 检查是否为内置插件（不允许覆盖）
      if (BUILTIN_PLUGIN_IDS.has(manifest.id)) {
        throw Errors.FORBIDDEN(`"${manifest.id}" 是内置插件，不允许覆盖`)
      }

      // 复制到 plugins/ 目录
      const destDir = path.join(getPluginsSourceDir(), manifest.id)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }
      copyPluginDir(resolvedSource, destDir)

      // 注册到存储
      const installed = await (async () => {
        const { registerPlugin } = await import('../core/storage/plugin/store')
        return registerPlugin(manifest, destDir)
      })()

      // 执行安装后钩子
      await pluginRegistry.onPostInstall(installed.id)

      return reply.status(201).send(
        apiSuccess({
          plugin: installed,
          message: `插件 "${manifest.name}" (${manifest.id}) 安装成功`,
        }),
      )
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/plugins/install — 从 source 安装插件（兼容简化格式）
  app.post('/api/plugins/install', async (request, reply) => {
    try {
      const body = request.body as { source?: string; isNpm?: boolean; version?: string }
      const source = (body.source ?? '').trim()

      if (!source) {
        throw Errors.VALIDATION_ERROR('source', '安装来源不能为空')
      }

      if (body.isNpm) {
        // TODO: npm 包安装逻辑
        throw Errors.INVALID_PARAM('isNpm', 'npm 安装暂未实现')
      }

      // 本地目录安装
      const installInput: Record<string, any> = { sourcePath: source }
      // 重定向到 install-file
      return pluginRoutesInstallFile(app, installInput, request, reply)
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  Plugin 启禁用 & 生命周期
  // ═══════════════════════════════════════════════════════════

  // PATCH /api/plugins/:id/toggle — 启用/禁用插件
  app.patch('/api/plugins/:id/toggle', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const { enabled } = request.body as { enabled: boolean }

      if (typeof enabled !== 'boolean') {
        throw Errors.VALIDATION_ERROR('enabled', '必须为 boolean 类型')
      }

      let plugin
      if (enabled) {
        plugin = await pluginRegistry.activatePlugin(id)
      } else {
        plugin = await pluginRegistry.deactivatePlugin(id)
      }

      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)

      return reply.send(apiSuccess({ plugin }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/plugins/:id/activate — 激活插件
  app.post('/api/plugins/:id/activate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const plugin = await pluginRegistry.activatePlugin(id)
      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)
      return reply.send(apiSuccess({ plugin, message: `插件已激活` }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/plugins/:id/deactivate — 停用插件
  app.post('/api/plugins/:id/deactivate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const plugin = await pluginRegistry.deactivatePlugin(id)
      if (!plugin) throw Errors.NOT_FOUND('Plugin', id)
      return reply.send(apiSuccess({ plugin, message: `插件已停用` }))
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/plugins/:id/hooks/:event — 手动执行钩子
  app.post('/api/plugins/:id/hooks/:event', async (request, reply) => {
    try {
      const { id, event } = request.params as { id: string; event: string }

      const validEvents: PluginHookEvent[] = [
        'pre-install', 'post-install',
        'pre-uninstall', 'post-uninstall',
        'on-enable', 'on-disable', 'on-upgrade',
        'pre-agent-run', 'post-agent-run',
      ]
      if (!validEvents.includes(event as PluginHookEvent)) {
        throw Errors.VALIDATION_ERROR(
          'event',
          `无效的钩子事件类型: ${event}。有效值: ${validEvents.join(', ')}`,
        )
      }

      await pluginRegistry.executeHook(id, event as PluginHookEvent)

      return reply.send(
        apiSuccess({
          pluginId: id,
          event,
          message: `钩子 "${event}" 执行完成`,
        }),
      )
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // ═══════════════════════════════════════════════════════════
  //  Plugin 扫描 & 注册
  // ═══════════════════════════════════════════════════════════

  // POST /api/plugins/scan — 扫描 plugins/ 目录
  app.post('/api/plugins/scan', async (request, reply) => {
    try {
      const body = request.body as Record<string, any> | undefined
      const dir = body?.dir || undefined
      const scanned = scanPluginFiles(dir)

      // 检查每个已扫描的 plugin 是否已注册
      const allStored = listPlugins()
      const storedNames = new Set(allStored.map((p) => p.name))

      const results = scanned.map((s) => ({
        ...s.manifest,
        dirName: s.dirName,
        dirPath: s.dirPath,
        alreadyRegistered: storedNames.has(s.manifest.name) || storedNames.has(s.manifest.id),
        valid: validatePluginManifest(s.manifest),
      }))

      return reply.send(
        apiSuccess({
          scanned: results,
          baseDir: dir || getPluginsBaseDir(),
          total: results.length,
          newCount: results.filter((r) => !r.alreadyRegistered).length,
          registeredCount: results.filter((r) => r.alreadyRegistered).length,
          invalidCount: results.filter((r) => !r.valid.valid).length,
        }),
      )
    } catch (err) {
      return apiError(reply, err)
    }
  })

  // POST /api/plugins/register — 从扫描结果批量注册插件
  app.post('/api/plugins/register', async (request, reply) => {
    try {
      const body = request.body as Record<string, any>
      const pluginIds: string[] = body.ids

      if (!Array.isArray(pluginIds) || pluginIds.length === 0) {
        throw Errors.VALIDATION_ERROR('ids', '必须提供要注册的插件 ID 列表')
      }

      const scanned = scanPluginFiles()
      const scannedMap = new Map(scanned.map((s) => [s.manifest.id, s]))

      const registered: any[] = []
      const skipped: string[] = []
      const errors: Array<{ id: string; error: string }> = []

      for (const pluginId of pluginIds) {
        const scannedPlugin = scannedMap.get(pluginId)
        if (!scannedPlugin) {
          errors.push({ id: pluginId, error: '未在扫描结果中找到该插件' })
          continue
        }

        // 验证
        const validation = validatePluginManifest(scannedPlugin.manifest)
        if (!validation.valid) {
          errors.push({ id: pluginId, error: validation.errors.join('; ') })
          continue
        }

        // 检查是否已存在
        const existing = findPluginByManifestId(pluginId)
        if (existing) {
          skipped.push(pluginId)
          continue
        }

        // 注册
        try {
          const { registerPlugin } = await import('../core/storage/plugin/store')
          const result = registerPlugin(scannedPlugin.manifest, scannedPlugin.dirPath)
          registered.push(result)
        } catch (e) {
          errors.push({ id: pluginId, error: String(e) })
        }
      }

      return reply.send(
        apiSuccess({
          registered: registered.length,
          skipped,
          errors,
        }),
      )
    } catch (err) {
      return apiError(reply, err)
    }
  })
}

// ─── 辅助函数 ────────────────────────────────────────────────

/**
 * 简化的 install-file 处理（用于 install 路由转发）
 */
async function pluginRoutesInstallFile(
  app: FastifyInstance,
  body: Record<string, any>,
  request: any,
  reply: any,
) {
  let sourcePath = (body.sourcePath ?? '').trim()

  if (!sourcePath) {
    throw Errors.VALIDATION_ERROR('sourcePath', '插件路径不能为空')
  }

  if (sourcePath.startsWith('~/')) {
    sourcePath = path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? '',
      sourcePath.slice(2),
    )
  }

  const resolvedSource = path.resolve(sourcePath)
  if (!fs.existsSync(resolvedSource)) {
    throw Errors.VALIDATION_ERROR('sourcePath', `路径不存在: ${resolvedSource}`)
  }
  if (!fs.statSync(resolvedSource).isDirectory()) {
    throw Errors.VALIDATION_ERROR('sourcePath', '路径必须是一个目录')
  }

  const scanned = scanPluginFiles(resolvedSource)
  let manifest = scanned.find((s) => s.dirPath === resolvedSource)?.manifest

  if (!manifest) {
    const directYaml = path.join(resolvedSource, 'plugin.yaml')
    if (!fs.existsSync(directYaml)) {
      throw Errors.VALIDATION_ERROR(
        'sourcePath',
        '该目录没有 plugin.yaml，不是合法的 Manta 插件',
      )
    }
    const results = scanPluginFiles(path.resolve(resolvedSource, '..'))
    manifest = results.find(
      (s) =>
        s.dirPath === resolvedSource ||
        s.manifest.id === path.basename(resolvedSource),
    )?.manifest
  }

  if (!manifest) {
    throw Errors.VALIDATION_ERROR(
      'sourcePath',
      '无法解析 plugin.yaml，不是合法的 Manta 插件',
    )
  }

  const validation = validatePluginManifest(manifest)
  if (!validation.valid) {
    throw Errors.VALIDATION_ERROR('manifest', validation.errors.join('; '))
  }

  if (BUILTIN_PLUGIN_IDS.has(manifest.id)) {
    throw Errors.FORBIDDEN(`"${manifest.id}" 是内置插件，不允许覆盖`)
  }

  const destDir = path.join(getPluginsSourceDir(), manifest.id)
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true })
  }
  copyPluginDir(resolvedSource, destDir)

  const { registerPlugin } = await import('../core/storage/plugin/store')
  const installed = registerPlugin(manifest, destDir)
  await pluginRegistry.onPostInstall(installed.id)

  return reply.status(201).send(
    apiSuccess({
      plugin: installed,
      message: `插件 "${manifest.name}" (${manifest.id}) 安装成功`,
    }),
  )
}
