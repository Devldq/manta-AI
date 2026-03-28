/*  start: Agent 管理页 — 查看/编辑各插件扫描到的 Agent 定义文件 */
'use client'

import { useState, useEffect, useCallback } from 'react'

interface AgentEntry {
  name: string
  runnerId: string
  description?: string
  enabled: boolean
  source?: string
  pluginId?: string
  filePath?: string
  fileReadonly?: boolean
}

interface AgentDefinition {
  name: string
  content: string | null
  filePath: string | null
  readonly: boolean
  pluginId?: string
  message?: string
}

// AI: 插件展示名称映射
const PLUGIN_LABELS: Record<string, { label: string; desc: string }> = {
  'openclaw':     { label: 'OpenClaw',    desc: '~/.openclaw/openclaw.json' },
  'claude-code':  { label: 'Claude Code', desc: '~/.claude/agents/' },
  'codeflicker':  { label: 'CodeFlicker', desc: '~/.codeflicker/internal/skills/' },
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  // AI: 当前展开查看的 agent
  const [selected, setSelected] = useState<AgentEntry | null>(null)

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
    // AI: 双栏布局：左侧 agent 列表 + 右侧定义详情面板
    <div className="flex h-full min-h-0">
      {/* 左栏：Agent 列表 */}
      <div className={`flex flex-col overflow-y-auto transition-all duration-200 ${selected ? 'w-[420px] flex-shrink-0' : 'flex-1'}`}>
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-semibold text-text-primary tracking-tight">Agent 管理</h1>
              <p className="mt-0.5 text-xs text-text-muted">
                {totalEnabled} 个可用 · 点击卡片查看/编辑定义
              </p>
            </div>
            <button
              onClick={fetchAgents}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs text-text-secondary rounded-md hover:bg-accent-subtle transition-colors disabled:opacity-50"
            >
              <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
              刷新
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-text-muted py-8 text-center">扫描中...</div>
          ) : agents.length === 0 ? (
            <div className="border border-dashed border-border-subtle rounded-lg p-10 text-center">
              <p className="text-text-muted text-sm">未扫描到任何 Agent</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(byPlugin).map(([pluginId, pluginAgents]) => {
                const info = PLUGIN_LABELS[pluginId]
                return (
                  <section key={pluginId}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                        {info?.label ?? pluginId}
                      </span>
                      {info && (
                        <span className="text-xs text-text-muted font-mono hidden sm:inline">{info.desc}</span>
                      )}
                      <span className="ml-auto text-xs text-text-muted">
                        {pluginAgents.length} 个
                      </span>
                    </div>
                    <div className="grid gap-1.5">
                      {pluginAgents.map((agent) => (
                        <AgentCard
                          key={agent.name}
                          agent={agent}
                          isSelected={selected?.name === agent.name}
                          onClick={() => setSelected(selected?.name === agent.name ? null : agent)}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          )}

          {!loading && (
            <p className="mt-5 text-xs text-text-muted">
              上次扫描：{lastRefresh.toLocaleTimeString('zh-CN')}
            </p>
          )}
        </div>
      </div>

      {/* 右栏：定义文件详情/编辑面板 */}
      {selected && (
        <div className="flex-1 border-l border-border min-w-0 flex flex-col">
          <AgentDefinitionPanel
            agent={selected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </div>
  )
}

// AI: Agent 列表卡片
function AgentCard({
  agent,
  isSelected,
  onClick,
}: {
  agent: AgentEntry
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between border rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${
        isSelected
          ? 'border-accent bg-accent-subtle'
          : agent.enabled
          ? 'border-border bg-surface hover:border-accent/40 hover:bg-accent-subtle/50'
          : 'border-border-subtle bg-background opacity-50'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          agent.enabled ? 'bg-status-done' : 'bg-status-archived'
        }`} />
        <div className="min-w-0">
          <span className="text-sm font-medium text-text-primary font-mono truncate block">{agent.name}</span>
          {agent.description && (
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-[260px]">{agent.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {agent.fileReadonly && (
          <span className="text-xs text-text-muted">🔒</span>
        )}
        <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded font-mono text-text-secondary">
          {agent.runnerId}
        </span>
        <span className={`text-xs text-text-muted transition-transform ${isSelected ? 'rotate-180' : ''}`}>›</span>
      </div>
    </button>
  )
}

// AI: 右侧定义文件详情 + 编辑面板
function AgentDefinitionPanel({
  agent,
  onClose,
}: {
  agent: AgentEntry
  onClose: () => void
}) {
  const [def, setDef] = useState<AgentDefinition | null>(null)
  const [loadingDef, setLoadingDef] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadDefinition = useCallback(async () => {
    setLoadingDef(true)
    setEditing(false)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/agents/definition?name=${encodeURIComponent(agent.name)}`)
      const data: AgentDefinition = await res.json()
      setDef(data)
      if (data.content) setEditContent(data.content)
    } catch {
      setDef(null)
    } finally {
      setLoadingDef(false)
    }
  }, [agent.name])

  useEffect(() => {
    loadDefinition()
  }, [loadDefinition])

  async function handleSave() {
    if (!def) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/agents/definition', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: agent.name, content: editContent }),
      })
      const data = await res.json()
      if (res.ok) {
        setSaveMsg({ ok: true, text: '已保存（自动备份为 .bak）' })
        setEditing(false)
        // AI: 重新加载最新内容
        const fresh = await fetch(`/api/agents/definition?name=${encodeURIComponent(agent.name)}`)
        const freshData = await fresh.json()
        setDef(freshData)
        if (freshData.content) setEditContent(freshData.content)
      } else {
        setSaveMsg({ ok: false, text: data.error || '保存失败' })
      }
    } catch {
      setSaveMsg({ ok: false, text: '网络错误' })
    } finally {
      setSaving(false)
    }
  }

  // AI: 文件格式标记
  const fileExt = def?.filePath ? def.filePath.split('.').pop() ?? '' : ''
  const langLabel = fileExt === 'json' ? 'JSON' : fileExt === 'md' ? 'Markdown' : fileExt === 'yaml' || fileExt === 'yml' ? 'YAML' : fileExt.toUpperCase()

  return (
    <div className="flex flex-col h-full">
      {/* 面板 Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-sm font-semibold text-text-primary truncate">{agent.name}</span>
          {langLabel && (
            <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded text-text-muted font-mono">
              {langLabel}
            </span>
          )}
          {def?.readonly && (
            <span className="text-xs px-1.5 py-0.5 bg-background border border-amber-400/30 rounded text-amber-500 font-mono">
              🔒 只读
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 编辑/保存按钮 */}
          {def?.content && !def.readonly && !editing && (
            <button
              onClick={() => { setEditing(true); setSaveMsg(null) }}
              className="px-3 py-1 text-xs border border-border rounded-md text-text-secondary hover:bg-accent-subtle transition-colors"
            >
              编辑
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => { setEditing(false); setEditContent(def?.content ?? ''); setSaveMsg(null) }}
                className="px-3 py-1 text-xs border border-border rounded-md text-text-secondary hover:bg-accent-subtle transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1 text-xs bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-secondary transition-colors rounded"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 文件路径 */}
      {def?.filePath && (
        <div className="px-5 py-2 border-b border-border-subtle bg-surface flex-shrink-0">
          <span className="text-xs font-mono text-text-muted truncate block">{def.filePath}</span>
        </div>
      )}

      {/* 保存结果提示 */}
      {saveMsg && (
        <div className={`px-5 py-2 text-xs flex-shrink-0 ${saveMsg.ok ? 'text-status-done bg-status-done/5' : 'text-status-failed bg-status-failed/5'}`}>
          {saveMsg.text}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {loadingDef ? (
          <div className="p-6 text-sm text-text-muted">加载中...</div>
        ) : !def?.content ? (
          <div className="p-6 text-sm text-text-muted">
            {def?.message ?? '无可查看的定义文件'}
          </div>
        ) : editing ? (
          // AI: 编辑模式 — textarea
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full p-5 text-xs font-mono bg-background text-text-primary focus:outline-none resize-none leading-relaxed"
            spellCheck={false}
          />
        ) : (
          // AI: 只读模式 — 高亮代码块
          <pre className="p-5 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words overflow-x-auto">
            {def.content}
          </pre>
        )}
      </div>

      {/* 只读说明 */}
      {def?.readonly && def.content && (
        <div className="px-5 py-2 border-t border-border-subtle bg-surface flex-shrink-0">
          <p className="text-xs text-amber-500">
            ⚠️ 此文件含敏感配置（如 API Key），仅供只读查看，请勿直接修改
          </p>
        </div>
      )}
    </div>
  )
}
/*  end: Agent 管理页结束 */
