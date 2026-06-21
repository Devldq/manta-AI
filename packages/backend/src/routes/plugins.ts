import type { FastifyInstance } from 'fastify'
import { listPlugins, readDisabledSet, writeDisabledSet } from '../plugins/loader'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const PLUGINS_DIR = path.join(process.cwd(), 'plugins')
const BUILTIN_PLUGIN_DIRS = new Set(['openclaw'])

function readPluginYaml(dir: string): { id: string; name: string } | null {
  const manifestPath = path.join(dir, 'plugin.yaml')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const parsed = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
    if (!parsed?.id || !parsed?.name) return null
    return { id: String(parsed.id), name: String(parsed.name) }
  } catch { return null }
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath)
    else fs.copyFileSync(srcPath, destPath)
  }
}

export async function pluginRoutes(app: FastifyInstance) {
  // GET /api/plugins — 列出所有插件
  app.get('/api/plugins', async (_request, reply) => {
    try {
      const plugins = listPlugins()
      return reply.send({ plugins })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // PATCH /api/plugins/:id — 启用/禁用插件
  app.patch('/api/plugins/:id', async (request, reply) => {
    try {
      const { id: pluginId } = request.params as { id: string }
      const body = request.body as { disabled?: boolean }
      const disabled = Boolean(body.disabled)

      const plugins = listPlugins()
      const plugin = plugins.find((p) => p.id === pluginId)
      if (!plugin) return reply.status(404).send({ success: false, error: '插件不存在' })

      const disabledSet = readDisabledSet()
      if (disabled) disabledSet.add(pluginId)
      else disabledSet.delete(pluginId)
      writeDisabledSet(disabledSet)
      return reply.send({ success: true, pluginId, disabled })
    } catch (err) {
      return reply.status(500).send({ success: false, error: String(err) })
    }
  })

  // POST /api/plugins/install — 安装插件
  app.post('/api/plugins/install', async (request, reply) => {
    try {
      const body = request.body as { sourcePath?: string }
      let sourcePath = (body.sourcePath ?? '').trim()
      if (!sourcePath) return reply.status(400).send({ success: false, error: '插件路径不能为空' })

      if (sourcePath.startsWith('~/')) {
        sourcePath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', sourcePath.slice(2))
      }

      const resolvedSource = path.resolve(sourcePath)
      if (!fs.existsSync(resolvedSource)) return reply.status(400).send({ success: false, error: `路径不存在: ${resolvedSource}` })
      if (!fs.statSync(resolvedSource).isDirectory()) return reply.status(400).send({ success: false, error: '路径必须是一个目录' })

      const manifest = readPluginYaml(resolvedSource)
      if (!manifest) return reply.status(400).send({ success: false, error: '该目录没有 plugin.yaml，不是合法的 Manta 插件' })
      if (BUILTIN_PLUGIN_DIRS.has(manifest.id)) return reply.status(403).send({ success: false, error: `"${manifest.id}" 是内置插件，不允许覆盖` })

      const destDir = path.join(PLUGINS_DIR, manifest.id)
      if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true })
      copyDirRecursive(resolvedSource, destDir)
      return reply.send({ success: true, pluginId: manifest.id, pluginName: manifest.name })
    } catch (err) {
      return reply.status(500).send({ success: false, error: String(err) })
    }
  })

  // DELETE /api/plugins/install — 卸载插件
  app.delete('/api/plugins/install', async (request, reply) => {
    try {
      const body = request.body as { pluginId?: string }
      const pluginId = (body.pluginId ?? '').trim()
      if (!pluginId) return reply.status(400).send({ success: false, error: 'pluginId 不能为空' })
      if (BUILTIN_PLUGIN_DIRS.has(pluginId)) return reply.status(403).send({ success: false, error: '内置插件不允许卸载' })

      const pluginDir = path.join(PLUGINS_DIR, pluginId)
      if (!fs.existsSync(pluginDir)) return reply.status(404).send({ success: false, error: '插件不存在' })

      fs.rmSync(pluginDir, { recursive: true, force: true })
      return reply.send({ success: true })
    } catch (err) {
      return reply.status(500).send({ success: false, error: String(err) })
    }
  })
}
