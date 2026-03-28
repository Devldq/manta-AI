/*  start: Agent 管理页 — 展示各插件扫描到的 Agent，Manta 不持有定义权 */
'use client'

import { useState, useEffect } from 'react'

interface AgentEntry {
  name: string
  runnerId: string
  description?: string
  enabled: boolean
  source?: string
  pluginId?: string
}

// AI: 插件展示名称映射
const PLUGIN_LABELS: Record<string, { label: string; desc: string }> = {
  'openclaw':     { label: 'OpenClaw',    desc: '~/.openclaw/agents/' },
  'claude-code':  { label: 'Claude Code', desc: '~/.claude/agents/' },
  'codeflicker':  { label: 'CodeFlicker', desc: '~/.codeflicker/skills/' },
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  useEffect(() => {
    fetchAgents()
  }, [])

  async function fetchAgents() {
    setLoading(true)
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      setAgents(data.agents ?? [])
      setLastRefresh(new Date())
    } catch {
      console.error('获取 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }

  // AI: 按 pluginId 分组
  const byPlugin = agents.reduce<Record<string, AgentEntry[]>>((acc, a) => {
    const key = a.pluginId ?? 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  const totalEnabled = agents.filter((a) => a.enabled).length

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Agent 管理</h1>
          <p className="mt-1 text-sm text-text-muted">
            从各 CLI 工具目录扫描 · {totalEnabled} 个可用 Agent
          </p>
        </div>
        <button
          onClick={fetchAgents}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-border text-sm text-text-secondary rounded-md hover:bg-accent-subtle transition-colors disabled:opacity-50"
        >
          <span className={loading ? 'animate-spin' : ''}>↻</span>
          <span>刷新</span>
        </button>
      </div>

      {/* 说明卡片 */}
      <div className="mb-6 p-4 bg-surface border border-border-subtle rounded-lg">
        <p className="text-xs font-medium text-text-secondary mb-2">扫描目录</p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(PLUGIN_LABELS).map(([id, info]) => (
            <div key={id} className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 bg-background border border-border rounded-md text-text-secondary font-mono">
                {id}
              </span>
              <span className="text-xs text-text-muted font-mono">{info.desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-2">
          Agent 定义权在各 CLI 工具中，Manta 扫描后自动加载。点击"刷新"重新扫描。
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-text-muted">扫描中...</div>
      ) : agents.length === 0 ? (
        <div className="border border-dashed border-border-subtle rounded-lg p-12 text-center">
          <p className="text-text-muted text-sm">未扫描到任何 Agent</p>
          <p className="text-text-muted text-xs mt-2 space-y-1">
            <span className="block">· openclaw：请确认 ~/.openclaw/agents/ 目录下有 agent 配置文件</span>
            <span className="block">· claude-code：请确认 ~/.claude/agents/ 目录下有 sub-agent .md 文件</span>
            <span className="block">· codeflicker：请确认 ~/.codeflicker/skills/ 目录下有 skill 文件夹</span>
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byPlugin).map(([pluginId, pluginAgents]) => {
            const info = PLUGIN_LABELS[pluginId]
            return (
              <section key={pluginId}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                    {info?.label ?? pluginId}
                  </span>
                  {info && (
                    <span className="text-xs text-text-muted font-mono">{info.desc}</span>
                  )}
                  <span className="ml-auto text-xs text-text-muted bg-surface border border-border-subtle px-1.5 py-0.5 rounded-full">
                    {pluginAgents.length} 个
                  </span>
                </div>
                <div className="grid gap-2">
                  {pluginAgents.map((agent) => (
                    <AgentCard key={agent.name} agent={agent} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {!loading && (
        <p className="mt-6 text-xs text-text-muted">
          上次扫描：{lastRefresh.toLocaleTimeString('zh-CN')}
        </p>
      )}
    </div>
  )
}

// AI: Agent 卡片（只读展示）
function AgentCard({ agent }: { agent: AgentEntry }) {
  return (
    <div className={`flex items-center justify-between border rounded-lg px-4 py-3 transition-colors ${
      agent.enabled ? 'border-border bg-surface' : 'border-border-subtle bg-background opacity-50'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          agent.enabled ? 'bg-status-done' : 'bg-status-archived'
        }`} />
        <div>
          <span className="text-sm font-medium text-text-primary font-mono">{agent.name}</span>
          {agent.description && (
            <p className="text-xs text-text-muted mt-0.5 max-w-lg truncate">{agent.description}</p>
          )}
        </div>
      </div>
      <span className="text-xs px-2 py-1 bg-background border border-border rounded font-mono text-text-secondary flex-shrink-0 ml-4">
        {agent.runnerId}
      </span>
    </div>
  )
}
/*  end: Agent 管理页结束 */
