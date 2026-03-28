/*  start: Agent 管理页 — 按来源分组显示（plugin-native / manta-custom），支持注册自定义 Agent */
'use client'

import { useState, useEffect } from 'react'

interface AgentEntry {
  name: string
  runnerId: string
  bin?: string
  skills?: string[]
  description?: string
  enabled: boolean
  source?: 'plugin-native' | 'manta-custom'
  pluginId?: string
}

// AI: Runner 来源标签映射
const PLUGIN_LABELS: Record<string, string> = {
  'openclaw': 'OpenClaw',
  'claude-code': 'Claude Code',
  'codeflicker': 'CodeFlicker',
  'generic-cli': '通用 CLI',
}

// AI: 来源徽章样式
function SourceBadge({ source, pluginId }: { source?: string; pluginId?: string }) {
  if (source === 'plugin-native') {
    return (
      <span className="text-xs px-1.5 py-0.5 bg-accent-subtle text-text-secondary rounded border border-border-subtle">
        {pluginId ? PLUGIN_LABELS[pluginId] ?? pluginId : '插件'}
      </span>
    )
  }
  return (
    <span className="text-xs px-1.5 py-0.5 bg-background text-text-muted rounded border border-border-subtle">
      自定义
    </span>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    fetchAgents()
  }, [])

  async function fetchAgents() {
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      setAgents(data.agents ?? [])
    } catch {
      console.error('获取 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }

  // AI: 按来源分组
  const pluginNativeAgents = agents.filter((a) => a.source === 'plugin-native')
  const customAgents = agents.filter((a) => a.source !== 'plugin-native')

  // AI: 按 pluginId 分组 plugin-native agents
  const byPlugin = pluginNativeAgents.reduce<Record<string, AgentEntry[]>>((acc, a) => {
    const key = a.pluginId ?? 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Agent 管理</h1>
          <p className="mt-1 text-sm text-text-muted">插件扫描到的 Agent + 用户自定义 Agent</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-accent text-text-inverse text-sm rounded-md hover:bg-accent-hover transition-colors"
        >
          <span>+</span>
          <span>注册自定义 Agent</span>
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-text-muted">加载中...</div>
      ) : (
        <div className="space-y-8">
          {/* plugin-native agents 按插件分组 */}
          {Object.entries(byPlugin).map(([pluginId, pluginAgents]) => (
            <section key={pluginId}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                  {PLUGIN_LABELS[pluginId] ?? pluginId}
                </span>
                <span className="text-xs text-text-muted bg-surface border border-border-subtle px-1.5 py-0.5 rounded-full">
                  {pluginAgents.length} 个 Agent
                </span>
                <span className="text-xs text-text-muted ml-1">· 目录扫描</span>
              </div>
              <div className="space-y-2">
                {pluginAgents.map((agent) => (
                  <AgentCard key={agent.name} agent={agent} onRefresh={fetchAgents} />
                ))}
              </div>
            </section>
          ))}

          {/* 如果没有 plugin-native agents，显示提示 */}
          {pluginNativeAgents.length === 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">插件 Agent</span>
              </div>
              <div className="border border-dashed border-border-subtle rounded-lg p-8 text-center">
                <p className="text-text-muted text-sm">未扫描到任何插件 Agent</p>
                <p className="text-text-muted text-xs mt-1">
                  请确认 openclaw 已安装（~/.openclaw/agents/）或 Claude Code 已配置 sub-agents（~/.claude/agents/）
                </p>
              </div>
            </section>
          )}

          {/* 用户自定义 agents */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">自定义 Agent</span>
              <span className="text-xs text-text-muted bg-surface border border-border-subtle px-1.5 py-0.5 rounded-full">
                {customAgents.length} 个
              </span>
            </div>
            {customAgents.length === 0 ? (
              <div className="border border-dashed border-border-subtle rounded-lg p-8 text-center">
                <p className="text-text-muted text-sm">还没有自定义 Agent</p>
                <p className="text-text-muted text-xs mt-1">点击"注册自定义 Agent"添加</p>
              </div>
            ) : (
              <div className="space-y-2">
                {customAgents.map((agent) => (
                  <AgentCard key={agent.name} agent={agent} onRefresh={fetchAgents} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showAdd && (
        <AddAgentModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); fetchAgents() }}
        />
      )}
    </div>
  )
}

// AI: Agent 卡片
function AgentCard({ agent, onRefresh: _onRefresh }: { agent: AgentEntry; onRefresh: () => void }) {
  return (
    <div className={`border rounded-lg p-4 transition-colors ${
      agent.enabled ? 'border-border bg-surface' : 'border-border-subtle bg-background opacity-60'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.enabled ? 'bg-status-done' : 'bg-status-archived'}`} />
          <div>
            <span className="text-sm font-medium text-text-primary font-mono">{agent.name}</span>
            {agent.description && (
              <p className="text-xs text-text-muted mt-0.5">{agent.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <SourceBadge source={agent.source} pluginId={agent.pluginId} />
          <span className="text-xs px-2 py-1 bg-background border border-border rounded font-mono text-text-secondary">
            {agent.runnerId}
          </span>
        </div>
      </div>
      {agent.skills && agent.skills.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {agent.skills.map((skill) => (
            <span key={skill} className="text-xs px-1.5 py-0.5 bg-accent-subtle text-text-secondary rounded">
              {skill}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// AI: 注册 Agent 弹窗（仅创建 manta-custom agent）
function AddAgentModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({
    name: '',
    runnerId: 'openclaw',
    bin: '',
    description: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('Agent 名字不能为空')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '注册失败')
        return
      }
      onSuccess()
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-xl p-6 w-full max-w-md shadow-xl">
        <h2 className="text-base font-semibold text-text-primary mb-1">注册自定义 Agent</h2>
        <p className="text-xs text-text-muted mb-4">自定义 Agent 会保存到 ~/arm-data/registry/agents.yaml</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Agent 名字 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my-architect / my-dev"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Runner（网关）</label>
            <select
              value={form.runnerId}
              onChange={(e) => setForm({ ...form, runnerId: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="openclaw">openclaw</option>
              <option value="claude-code">claude-code</option>
              <option value="generic-cli">generic-cli（自定义 CLI）</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">CLI 路径（留空自动发现）</label>
            <input
              type="text"
              value={form.bin}
              onChange={(e) => setForm({ ...form, bin: e.target.value })}
              placeholder="/usr/local/bin/my-agent"
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="这个 Agent 的用途描述..."
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          {error && <p className="text-xs text-status-failed">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {loading ? '注册中...' : '注册'}
          </button>
        </div>
      </div>
    </div>
  )
}
/*  end: Agent 管理页结束 */
