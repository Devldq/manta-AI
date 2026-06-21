import type { FastifyInstance } from 'fastify'
import {
  getEffectiveServers,
  isBuiltinServer,
} from '../core/tools/mcp/config'
import { saveUserServer, getUserServer, deleteUserServer, loadMCPToolVisibility, saveMCPToolVisibility } from '../core/tools/mcp/config-store'
import { getAllMCPServerStatus, connectServerByName, disconnectServerByName, getToolRegistry } from '../core/tools/mcp/setup'
import { revokeOAuthToken, startOAuthFlow, checkOAuthToken } from '../core/tools/mcp/oauth'
import type { MCPServerEntry, LocalServerConfig, RemoteServerConfig, OAuthServerConfig, MCPToolVisibility } from '../core/tools/registry/types'
import { resolveEnvVarsInObject } from '../core/tools/registry/types'

export async function mcpRoutes(app: FastifyInstance) {
  // ─── MCP Servers ─────────────────────────────────────────────

  // GET /api/mcp/servers — 列出所有 MCP Server
  app.get('/api/mcp/servers', async (_request, reply) => {
    try {
      const statuses = await getAllMCPServerStatus()
      const effective = getEffectiveServers()
      const servers = effective.map((entry) => {
        const status = statuses.find((s) => s.name === entry.name)
        return {
          name: entry.name,
          description: entry.description,
          enabled: entry.enabled !== false,
          type: entry.config.type,
          isBuiltin: isBuiltinServer(entry.name),
          isConnected: status?.isConnected ?? false,
          toolCount: status?.toolCount ?? 0,
          toolNames: status?.toolNames ?? [],
          oauthRequired: status?.oauthRequired,
          oauthAuthorized: status?.oauthAuthorized,
          lastError: status?.lastError,
        }
      })
      return reply.send({ servers })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // POST /api/mcp/servers — 创建 MCP Server
  app.post('/api/mcp/servers', async (request, reply) => {
    try {
      const body = request.body as {
        name: string; description?: string; enabled?: boolean;
        type: 'local' | 'remote'; command?: string[];
        environment?: Record<string, string>; url?: string;
        headers?: Record<string, string>;
        oauth?: OAuthServerConfig; timeout?: number;
      }

      if (!body.name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(body.name)) {
        return reply.status(400).send({ error: 'name 必须是以字母开头、仅包含字母数字下划线横线的字符串' })
      }
      if (!body.type || !['local', 'remote'].includes(body.type)) {
        return reply.status(400).send({ error: 'type 必须是 "local" 或 "remote"' })
      }
      if (getEffectiveServers().find((s) => s.name === body.name)) {
        return reply.status(409).send({ error: `MCP Server "${body.name}" 已存在` })
      }
      if (body.type === 'local' && (!body.command || body.command.length === 0)) {
        return reply.status(400).send({ error: 'local 模式必须提供 command 数组' })
      }
      if (body.type === 'remote' && !body.url) {
        return reply.status(400).send({ error: 'remote 模式必须提供 url 字段' })
      }

      let config: LocalServerConfig | RemoteServerConfig
      if (body.type === 'local') {
        config = { type: 'local', command: body.command!, environment: body.environment, oauth: body.oauth, timeout: body.timeout }
      } else {
        config = { type: 'remote', url: body.url!, headers: body.headers, oauth: body.oauth, timeout: body.timeout }
      }

      const entry = { name: body.name, description: body.description ?? '', enabled: body.enabled !== false, config }
      saveUserServer(entry)

      let isConnected = false, toolCount = 0, toolNames: string[] = []
      if (body.type === 'local' && entry.enabled) {
        try {
          const tools = await connectServerByName(body.name)
          isConnected = true; toolCount = tools.length; toolNames = tools
        } catch (err) {
          console.warn(`[MCP:servers] ${body.name} local 连接失败:`, err instanceof Error ? err.message : String(err))
        }
      }

      return reply.status(201).send({
        server: { name: entry.name, description: entry.description, enabled: entry.enabled, type: entry.config.type, isBuiltin: false, isConnected, toolCount, toolNames },
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // PUT /api/mcp/servers/:name — 更新 MCP Server
  app.put('/api/mcp/servers/:name', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      const body = request.body as { description?: string; enabled?: boolean; config?: { type: 'local' | 'remote'; command?: string[]; environment?: Record<string, string>; timeout?: number; url?: string; headers?: Record<string, string>; oauth?: OAuthServerConfig } }

      const builtin = isBuiltinServer(name)
      const userEntry = getUserServer(name)
      let existing: MCPServerEntry | undefined = builtin ? getEffectiveServers().find((s) => s.name === name) : userEntry
      if (!existing) return reply.status(404).send({ error: `未找到 MCP Server: ${name}` })
      if (body.config && builtin) return reply.status(403).send({ error: `内建 MCP Server "${name}" 不允许修改连接配置` })

      let configChanged = false
      let newConfig = existing.config
      if (body.config) {
        if (body.config.type === 'local') {
          if (!body.config.command?.length) return reply.status(400).send({ error: 'local 模式必须提供 command 数组' })
          newConfig = { type: 'local', command: body.config.command, environment: body.config.environment, oauth: body.config.oauth, timeout: body.config.timeout }
          configChanged = true
        } else if (body.config.type === 'remote') {
          if (!body.config.url) return reply.status(400).send({ error: 'remote 模式必须提供 url 字段' })
          newConfig = { type: 'remote', url: body.config.url, headers: body.config.headers, oauth: body.config.oauth, timeout: body.config.timeout }
          configChanged = true
        }
      }

      const updatedEntry: MCPServerEntry = { ...existing, description: body.description ?? existing.description, enabled: body.enabled !== undefined ? body.enabled : existing.enabled !== false, config: newConfig }
      saveUserServer(updatedEntry)

      let isConnected = false, toolCount = 0, toolNames: string[] = []
      if (configChanged) {
        try { await disconnectServerByName(name); if (existing.config.type === 'remote') await revokeOAuthToken(name) } catch { /* ignore */ }
      }
      if (!updatedEntry.enabled) { try { await disconnectServerByName(name) } catch { /* ignore */ } }
      if (updatedEntry.enabled) {
        try {
          if (updatedEntry.config.type === 'local') {
            const tools = await connectServerByName(name)
            isConnected = true; toolCount = tools.length; toolNames = tools
          }
        } catch (err) { console.warn(`[MCP:servers] ${name} 重连失败:`, err instanceof Error ? err.message : String(err)) }
      }

      return reply.send({
        server: { name: updatedEntry.name, description: updatedEntry.description, enabled: updatedEntry.enabled, type: updatedEntry.config.type, isBuiltin: builtin, isConnected, toolCount, toolNames },
      })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // DELETE /api/mcp/servers/:name — 删除 MCP Server
  app.delete('/api/mcp/servers/:name', async (request, reply) => {
    try {
      const { name } = request.params as { name: string }
      if (isBuiltinServer(name)) return reply.status(403).send({ error: `内建 MCP Server "${name}" 不可删除` })
      if (!getUserServer(name)) return reply.status(404).send({ error: `未找到 MCP Server: ${name}` })
      await revokeOAuthToken(name)
      try { await disconnectServerByName(name) } catch { /* ignore */ }
      deleteUserServer(name)
      return reply.send({ success: true, name })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // ─── MCP Status ──────────────────────────────────────────────

  // GET /api/mcp/status — MCP Server 状态
  app.get('/api/mcp/status', async (request, reply) => {
    try {
      const serverName = (request.query as Record<string, string>).server
      const statuses = await getAllMCPServerStatus()
      if (serverName) {
        const status = statuses.find((s) => s.name === serverName)
        if (!status) {
          const entry = getEffectiveServers().find((s) => s.name === serverName)
          if (!entry) return reply.status(404).send({ error: `未找到 MCP Server: ${serverName}` })
          return reply.send({ server: { name: entry.name, description: entry.description, enabled: entry.enabled !== false, isConnected: false, status: 'not_connected' } })
        }
        return reply.send({ server: status })
      }
      return reply.send({ servers: statuses })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // ─── MCP Visibility ──────────────────────────────────────────

  // GET /api/mcp/visibility — 获取工具可见性配置
  app.get('/api/mcp/visibility', async (_request, reply) => {
    try {
      const visibility = loadMCPToolVisibility()
      return reply.send({ visibility })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // PUT /api/mcp/visibility — 更新工具可见性配置
  app.put('/api/mcp/visibility', async (request, reply) => {
    try {
      const body = request.body as MCPToolVisibility
      if (!body || typeof body !== 'object') return reply.status(400).send({ error: '无效的配置格式' })
      saveMCPToolVisibility(body)
      return reply.send({ success: true, visibility: body })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // ─── MCP OAuth ───────────────────────────────────────────────

  // GET /api/mcp/oauth/start — 发起 OAuth 授权
  app.get('/api/mcp/oauth/start', async (request, reply) => {
    try {
      const serverName = (request.query as Record<string, string>).server
      if (!serverName) return reply.status(400).send({ error: '缺少 server 参数' })

      const entry = getEffectiveServers().find((s) => s.name === serverName)
      if (!entry) return reply.status(404).send({ error: `未找到 MCP Server: ${serverName}` })

      let oauthConfig: OAuthServerConfig | undefined
      if (entry.config.type === 'remote') oauthConfig = (entry.config as RemoteServerConfig).oauth
      else if (entry.config.type === 'local') oauthConfig = (entry.config as LocalServerConfig).oauth

      if (!oauthConfig) return reply.status(400).send({ error: `${serverName} 未配置 OAuth` })
      if (!oauthConfig.clientId) return reply.status(500).send({ error: `${serverName} 未配置 clientId` })

      const resolvedOAuth = resolveEnvVarsInObject(oauthConfig)
      const { authorizationUrl, state } = await startOAuthFlow(serverName, resolvedOAuth)
      return reply.send({ authorizationUrl, state })
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })

  // GET /api/mcp/oauth/status — 查询 OAuth 状态
  app.get('/api/mcp/oauth/status', async (request, reply) => {
    try {
      const serverName = (request.query as Record<string, string>).server
      if (!serverName) return reply.status(400).send({ error: '缺少 server 参数' })

      const entry = getEffectiveServers().find((s) => s.name === serverName)
      if (!entry) return reply.status(404).send({ error: `未找到 MCP Server: ${serverName}` })

      let oauthConfig: OAuthServerConfig | undefined
      if (entry.config.type === 'remote') oauthConfig = (entry.config as RemoteServerConfig).oauth
      else if (entry.config.type === 'local') oauthConfig = (entry.config as LocalServerConfig).oauth

      if (!oauthConfig) return reply.status(400).send({ error: `${serverName} 未配置 OAuth` })

      const resolvedOAuth = resolveEnvVarsInObject(oauthConfig)
      const hasToken = await checkOAuthToken(serverName, resolvedOAuth)
      if (!hasToken) return reply.send({ connected: false, serverName })

      try {
        const tools = await connectServerByName(serverName)
        return reply.send({ connected: true, serverName, toolCount: tools.length, toolNames: tools })
      } catch (err) {
        return reply.send({ connected: false, serverName, error: String(err) })
      }
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
