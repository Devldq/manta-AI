/* MCP Server 管理页 — /mcp */
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Edit3, Plug, Unplug, RefreshCw, Server,
  Wrench, Globe, CheckCircle2, XCircle, AlertCircle,
  Loader2, Shield, ChevronDown, Terminal, Eye
} from 'lucide-react'

interface MCPServerListItem {
  name: string
  description: string
  enabled: boolean
  type: 'local' | 'remote'
  isBuiltin: boolean
  isConnected: boolean
  toolCount: number
  toolNames: string[]
  oauthRequired?: boolean
  oauthAuthorized?: boolean
  lastError?: string
}

interface ServerFormData {
  name: string
  description: string
  enabled: boolean
  type: 'local' | 'remote'
  command: string
  env: string
  url: string
  headerKey: string
  headerValue: string
  hasOauth: boolean
  oauthAuthorizationEndpoint: string
  oauthTokenEndpoint: string
  oauthClientId: string
  oauthClientSecret: string
  oauthScopes: string
  oauthTokenEnvVar: string
  timeout: string
}

const emptyForm: ServerFormData = {
  name: '',
  description: '',
  enabled: true,
  type: 'local',
  command: '',
  env: '',
  url: '',
  headerKey: '',
  headerValue: '',
  hasOauth: false,
  oauthAuthorizationEndpoint: '',
  oauthTokenEndpoint: '',
  oauthClientId: '',
  oauthClientSecret: '',
  oauthScopes: '',
  oauthTokenEnvVar: '',
  timeout: '5000',
}

export default function MCPServersPage() {
  const [servers, setServers] = useState<MCPServerListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingServer, setEditingServer] = useState<string | null>(null)
  const [form, setForm] = useState<ServerFormData>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [expandedServer, setExpandedServer] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      setError('')
      const res = await fetch('/api/mcp/servers')
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '加载失败')
        return
      }
      const data = await res.json()
      setServers(data.servers || [])
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  function openCreateModal() {
    setEditingServer(null)
    setForm(emptyForm)
    setFormError('')
    setShowModal(true)
  }

  function openEditModal(server: MCPServerListItem) {
    setEditingServer(server.name)
    setForm({
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      type: server.type,
      command: '',
      env: '',
      url: '',
      headerKey: '',
      headerValue: '',
      hasOauth: false,
      oauthAuthorizationEndpoint: '',
      oauthTokenEndpoint: '',
      oauthClientId: '',
      oauthClientSecret: '',
      oauthScopes: '',
      oauthTokenEnvVar: '',
      timeout: '5000',
    })
    setFormError('')
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditingServer(null)
    setForm(emptyForm)
    setFormError('')
  }

  function validateForm(): boolean {
    if (!form.name.trim()) {
      setFormError('名称不能为空')
      return false
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(form.name.trim())) {
      setFormError('名称必须以字母开头，仅包含字母、数字、下划线和横线')
      return false
    }
    if (form.type === 'local' && !form.command.trim()) {
      setFormError('local 模式需要提供命令')
      return false
    }
    if (form.type === 'remote' && !form.url.trim()) {
      setFormError('remote 模式需要提供 URL')
      return false
    }
    return true
  }

  async function handleSubmit() {
    if (!validateForm()) return

    setSubmitting(true)
    setFormError('')

    try {
      const envObj: Record<string, string> = {}
      if (form.env.trim()) {
        form.env.split('\n').forEach((line) => {
          const idx = line.indexOf('=')
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
          }
        })
      }

      const commandArr = form.command.trim()
        ? form.command.trim().split(/\s+/)
        : []

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        type: form.type,
      }

      if (form.type === 'local') {
        body.command = commandArr
        if (Object.keys(envObj).length > 0) {
          body.environment = envObj
        }
      } else {
        body.url = form.url.trim()
        if (form.headerKey.trim() && form.headerValue.trim()) {
          body.headers = { [form.headerKey.trim()]: form.headerValue.trim() }
        }
      }

      if (form.timeout) {
        body.timeout = Number(form.timeout)
      }

      let res: Response
      if (editingServer) {
        res = await fetch(`/api/mcp/servers/${editingServer}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      const data = await res.json()
      if (!res.ok) {
        setFormError(data.error || '操作失败')
        return
      }

      closeModal()
      await loadServers()
    } catch {
      setFormError('网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`确定删除 MCP Server "${name}"？`)) return

    try {
      const res = await fetch(`/api/mcp/servers/${name}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '删除失败')
        return
      }
      await loadServers()
    } catch {
      alert('网络错误')
    }
  }

  async function handleToggleEnabled(server: MCPServerListItem) {
    try {
      const res = await fetch(`/api/mcp/servers/${server.name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      })
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || '操作失败')
        return
      }
      await loadServers()
    } catch {
      alert('网络错误')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            MCP 服务器
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            管理 MCP 服务器连接，扩展 AI 工具能力
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-text-inverse transition-colors"
        >
          <Plus size={16} />
          添加服务器
        </button>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
          {error}
          <button onClick={loadServers} className="ml-3 underline">重试</button>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="text-center py-16 rounded-xl border border-border bg-background">
          <Server size={48} className="mx-auto mb-4 text-text-muted" />
          <p className="text-sm mb-4 text-text-secondary">尚未配置任何 MCP 服务器</p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-text-inverse transition-colors"
          >
            <Plus size={16} />
            添加第一个服务器
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <ServerCard
              key={server.name}
              server={server}
              expanded={expandedServer === server.name}
              onToggleExpand={() => setExpandedServer(expandedServer === server.name ? null : server.name)}
              onEdit={() => openEditModal(server)}
              onDelete={() => handleDelete(server.name)}
              onToggleEnabled={() => handleToggleEnabled(server)}
              onRefresh={loadServers}
            />
          ))}
        </div>
      )}

      {showModal && (
        <ServerFormModal
          form={form}
          setForm={setForm}
          isEditing={!!editingServer}
          submitting={submitting}
          error={formError}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </div>
  )
}

function ServerCard({ server, expanded, onToggleExpand, onEdit, onDelete, onToggleEnabled, onRefresh }: {
  server: MCPServerListItem
  expanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onRefresh: () => void
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  async function handleConnect() {
    setActionLoading('connect')
    try {
      const res = await fetch(`/api/mcp/oauth/start?server=${encodeURIComponent(server.name)}`)
      if (!res.ok) {
        const data = await res.json()
        alert(data.error || 'OAuth 启动失败')
        return
      }
      const data = await res.json()
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank')
      }
    } catch {
      alert('网络错误')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className={`rounded-xl border border-border transition-colors ${server.enabled ? 'bg-background' : 'bg-surface opacity-60'}`}>
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={onToggleExpand}
          className="flex-shrink-0 p-1 rounded transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <ChevronDown size={16} className="text-text-muted" />
        </button>

        <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-surface">
          {server.isBuiltin ? (
            <Shield size={18} className="text-accent" />
          ) : server.type === 'local' ? (
            <Terminal size={18} className="text-accent" />
          ) : (
            <Globe size={18} className="text-accent" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate text-text-primary">{server.name}</h3>
            {server.isBuiltin && (
              <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface text-accent border border-accent">
                内建
              </span>
            )}
          </div>
          <p className="text-xs mt-0.5 truncate text-text-muted">
            {server.description || (server.type === 'local' ? '本地子进程' : '远程 HTTP 服务')}
          </p>
        </div>

        <div className="flex-shrink-0">
          <StatusBadge server={server} />
        </div>

        <div className="flex-shrink-0 flex items-center gap-1">
          {server.oauthRequired && server.enabled && !server.isConnected && (
            <button
              onClick={handleConnect}
              disabled={actionLoading === 'connect'}
              className="p-1.5 rounded-lg transition-colors text-accent"
              title="OAuth 授权连接"
            >
              {actionLoading === 'connect' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
            </button>
          )}
          {!server.isBuiltin && (
            <>
              <button onClick={onEdit} className="p-1.5 rounded-lg transition-colors text-text-muted" title="编辑">
                <Edit3 size={16} />
              </button>
              <button onClick={onDelete} className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 text-text-muted" title="删除">
                <Trash2 size={16} />
              </button>
            </>
          )}
          <button onClick={onToggleEnabled} className="p-1.5 rounded-lg transition-colors text-text-muted" title={server.enabled ? '禁用' : '启用'}>
            <XCircle size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border mx-4">
          <div className="grid grid-cols-2 gap-3 mt-3">
            <DetailItem label="类型" value={server.type === 'local' ? 'Local (本地子进程)' : 'Remote (HTTP 服务)'} />
            <DetailItem label="状态" value={server.enabled ? (server.isConnected ? '已连接' : '未连接') : '已禁用'} />
            <DetailItem label="工具数" value={server.toolCount > 0 ? `${server.toolCount} 个工具` : '-'} />
            <DetailItem label="来源" value={server.isBuiltin ? '内建' : '用户自定义'} />
          </div>
          {server.toolNames.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] text-text-muted">已注册工具 ({server.toolNames.length})</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {server.toolNames.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 font-mono rounded bg-surface text-text-secondary border border-border">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[11px] text-text-muted">{label}</span>
      <p className="text-sm mt-0.5 text-text-primary">{value}</p>
    </div>
  )
}

function StatusBadge({ server }: { server: MCPServerListItem }) {
  if (!server.enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-surface text-text-muted">
        <XCircle size={12} /> 已禁用
      </span>
    )
  }
  if (server.isConnected) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-green-500/15 text-green-500">
        <CheckCircle2 size={12} /> 已连接 ({server.toolCount})
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-orange-500/15 text-orange-500">
      <AlertCircle size={12} /> 未连接
    </span>
  )
}

function ServerFormModal({ form, setForm, isEditing, submitting, error, onSubmit, onClose }: {
  form: ServerFormData
  setForm: (f: ServerFormData) => void
  isEditing: boolean
  submitting: boolean
  error: string
  onSubmit: () => void
  onClose: () => void
}) {
  const update = (patch: Partial<ServerFormData>) => setForm({ ...form, ...patch })

  return (
    <div className="fixed inset-0 flex items-start justify-center z-50 pt-[10vh] bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="rounded-xl border border-border shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto bg-background">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            {isEditing ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
          </h2>
          <button onClick={onClose} className="p-1 rounded transition-colors text-text-muted">
            <XCircle size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-text-secondary">名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              disabled={isEditing}
              placeholder="my-server"
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-text-secondary">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="简要描述"
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-text-secondary">连接类型 *</label>
            <div className="flex gap-2">
              {(['local', 'remote'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update({ type: t })}
                  className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                    form.type === t ? 'bg-accent text-text-inverse border-accent' : 'bg-surface text-text-secondary border-border'
                  }`}
                >
                  {t === 'local' ? 'Local (本地进程)' : 'Remote (HTTP)'}
                </button>
              ))}
            </div>
          </div>

          {form.type === 'local' && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1 text-text-secondary">命令 * (空格分隔)</label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => update({ command: e.target.value })}
                  placeholder="npx -y @modelcontextprotocol/server-github"
                  className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-text-secondary">环境变量 (每行 KEY=VALUE)</label>
                <textarea
                  value={form.env}
                  onChange={(e) => update({ env: e.target.value })}
                  placeholder="GITHUB_TOKEN=your_token"
                  rows={3}
                  className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none font-mono resize-none"
                />
              </div>
            </>
          )}

          {form.type === 'remote' && (
            <div>
              <label className="block text-xs font-medium mb-1 text-text-secondary">MCP Server URL *</label>
              <input
                type="text"
                value={form.url}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="https://mcp.example.com/mcp"
                className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1 text-text-secondary">超时 (毫秒)</label>
            <input
              type="number"
              value={form.timeout}
              onChange={(e) => update({ timeout: e.target.value })}
              placeholder="5000"
              min="0"
              className="w-full px-2 py-1.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none font-mono"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-medium text-text-secondary">启用</span>
            <button
              onClick={() => update({ enabled: !form.enabled })}
              className={`relative w-9 h-5 rounded-full transition-colors ${form.enabled ? 'bg-accent' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.enabled ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>

          {error && (
            <p className="text-xs p-2 rounded bg-red-500/10 text-red-500">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} disabled={submitting} className="px-4 py-2 text-xs rounded-lg text-text-secondary">
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-accent text-text-inverse disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? '提交中...' : isEditing ? '保存修改' : '添加服务器'}
          </button>
        </div>
      </div>
    </div>
  )
}
