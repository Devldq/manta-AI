import type { FastifyInstance } from 'fastify'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

/** 展开 ~ 路径 */
function expandDir(rawDir: string): string {
  if (rawDir.startsWith('~/')) return path.join(os.homedir(), rawDir.slice(2))
  return path.resolve(process.cwd(), rawDir)
}

/** 加载 openclaw agents */
function loadOpenclawAgents() {
  const configPath = expandDir('~/.openclaw/openclaw.json')
  if (!fs.existsSync(configPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    const list: Array<{ id?: string; name?: string; workspace?: string; agentDir?: string }> =
      parsed?.agents?.list ?? []
    return list.filter((a) => a.id).map((a) => ({
      name: a.name || a.id!,
      runnerId: 'openclaw',
      description: a.workspace ? `workspace: ${a.workspace}` : undefined,
      enabled: true,
      source: 'plugin-native',
      pluginId: 'openclaw',
      filePath: a.agentDir ? path.join(a.agentDir, 'models.json') : undefined,
      fileReadonly: true,
      soulEditable: true,
    }))
  } catch { return [] }
}

/** 汇总所有插件的 agents */
function loadAllAgents() {
  return loadOpenclawAgents()
}

export async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (request, reply) => {
    try {
      const { enabled } = request.query as { enabled?: string }
      const agents = loadAllAgents()
      const result = enabled === 'true' ? agents.filter((a) => a.enabled) : agents
      return reply.send({ agents: result })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
