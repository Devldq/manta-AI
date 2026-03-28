/*  start: Agent 管理页 — Manta 托管（可编辑）+ 外部 CLI（只读）分区展示 */
'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── 类型定义 ───────────────────────────────────────────────
interface MantaAgent {
  name: string
  targetCli: 'openclaw' | 'claude-code'
  description: string
  createdAt: string
  updatedAt: string
  soul: string
  agentDir?: string
}

interface ExternalAgent {
  name: string
  runnerId: string
  description?: string
  enabled: boolean
  pluginId?: string
  filePath?: string
  fileReadonly?: boolean
}

type SelectedAgent =
  | { type: 'manta'; agent: MantaAgent }
  | { type: 'external'; agent: ExternalAgent }

const CLI_LABEL: Record<string, string> = {
  'openclaw': 'OpenClaw',
  'claude-code': 'Claude Code',
  'codeflicker': 'CodeFlicker',
}

// ─── 主页面 ─────────────────────────────────────────────────
export default function AgentsPage() {
  const [mantaAgents, setMantaAgents] = useState<MantaAgent[]>([])
  const [externalAgents, setExternalAgents] = useState<ExternalAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SelectedAgent | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [injectStatus, setInjectStatus] = useState<'idle' | 'injecting' | 'done'>('idle')
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [mantaRes, extRes] = await Promise.all([
        fetch('/api/agents/manta'),
        fetch('/api/agents'),
      ])
      const mantaData = await mantaRes.json()
      const extData = await extRes.json()

      setMantaAgents(mantaData.agents ?? [])
      // AI: 外部 agent 里去掉跟 manta 同名的（manta 托管的已在 Manta 区展示）
      const mantaNames = new Set((mantaData.agents ?? []).map((a: MantaAgent) => a.name))
      setExternalAgents((extData.agents ?? []).filter((a: ExternalAgent) => !mantaNames.has(a.name)))
      setLastRefresh(new Date())
    } catch {
      console.error('获取 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // AI: 按 pluginId 分组外部 agent
  const byPlugin = externalAgents.reduce<Record<string, ExternalAgent[]>>((acc, a) => {
    const key = a.pluginId ?? 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  async function handleInject() {
    setInjectStatus('injecting')
    await fetch('/api/agents/inject', { method: 'POST' })
    setInjectStatus('done')
    setTimeout(() => setInjectStatus('idle'), 2000)
  }

  function handleSelectManta(agent: MantaAgent) {
    setSelected(selected?.type === 'manta' && selected.agent.name === agent.name ? null : { type: 'manta', agent })
  }

  function handleSelectExternal(agent: ExternalAgent) {
    setSelected(selected?.type === 'external' && selected.agent.name === agent.name ? null : { type: 'external', agent })
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 左栏 */}
      <div className={`flex flex-col overflow-y-auto transition-all duration-200 ${selected ? 'w-[420px] flex-shrink-0' : 'flex-1'}`}>
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-semibold text-text-primary tracking-tight">Agent 管理</h1>
              <p className="mt-0.5 text-xs text-text-muted">
                Manta 托管 {mantaAgents.length} 个 · 外部 CLI {externalAgents.length} 个 · 点击查看详情
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* 注入按钮 */}
              {mantaAgents.length > 0 && (
                <button
                  onClick={handleInject}
                  disabled={injectStatus === 'injecting'}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-xs text-text-secondary rounded-md hover:bg-accent-subtle transition-colors disabled:opacity-50"
                >
                  {injectStatus === 'injecting' ? '注入中...' : injectStatus === 'done' ? '✓ 已注入' : '↑ 注入到 CLI'}
                </button>
              )}
              <button
                onClick={fetchAll}
                disabled={loading}
                className="px-2.5 py-1.5 border border-border text-xs text-text-secondary rounded-md hover:bg-accent-subtle transition-colors disabled:opacity-50"
              >
                <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
              </button>
              {/* 新建按钮 */}
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-text-inverse text-xs rounded-md hover:bg-accent-hover transition-colors"
              >
                + 新建 Agent
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-text-muted py-8 text-center">加载中...</div>
          ) : (
            <div className="space-y-8">
              {/* Manta 托管区 */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-accent uppercase tracking-wider">Manta 托管</span>
                  <span className="text-xs px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded-full">{mantaAgents.length} 个</span>
                  <span className="text-xs text-text-muted ml-1">· 可编辑</span>
                </div>
                {mantaAgents.length === 0 ? (
                  <div className="border border-dashed border-border-subtle rounded-lg p-6 text-center">
                    <p className="text-xs text-text-muted">还没有 Manta 托管的 agent</p>
                    <button onClick={() => setShowCreate(true)} className="mt-2 text-xs text-accent hover:underline">
                      点击新建
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    {mantaAgents.map((agent) => (
                      <MantaAgentCard
                        key={agent.name}
                        agent={agent}
                        isSelected={selected?.type === 'manta' && selected.agent.name === agent.name}
                        onClick={() => handleSelectManta(agent)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* 外部 CLI 分区 */}
              {Object.entries(byPlugin).map(([pluginId, agents]) => (
                <section key={pluginId}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                      {CLI_LABEL[pluginId] ?? pluginId}
                    </span>
                    <span className="text-xs text-text-muted">只读</span>
                    <span className="ml-auto text-xs text-text-muted">{agents.length} 个</span>
                  </div>
                  <div className="grid gap-1.5">
                    {agents.map((agent) => (
                      <ExternalAgentCard
                        key={agent.name}
                        agent={agent}
                        isSelected={selected?.type === 'external' && selected.agent.name === agent.name}
                        onClick={() => handleSelectExternal(agent)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {!loading && (
            <p className="mt-5 text-xs text-text-muted">上次扫描：{lastRefresh.toLocaleTimeString('zh-CN')}</p>
          )}
        </div>
      </div>

      {/* 右栏：详情 / 编辑面板 */}
      {selected && (
        <div className="flex-1 border-l border-border min-w-0 flex flex-col">
          {selected.type === 'manta' ? (
            <MantaDetailPanel
              agent={selected.agent}
              onClose={() => setSelected(null)}
              onSaved={(updated) => {
                setMantaAgents((prev) => prev.map((a) => a.name === updated.name ? updated : a))
                setSelected({ type: 'manta', agent: updated })
              }}
              onDeleted={(name) => {
                setMantaAgents((prev) => prev.filter((a) => a.name !== name))
                setSelected(null)
              }}
            />
          ) : (
            <ExternalDetailPanel agent={selected.agent} onClose={() => setSelected(null)} />
          )}
        </div>
      )}

      {/* 新建弹窗 */}
      {showCreate && (
        <CreateAgentModal
          onClose={() => setShowCreate(false)}
          onCreated={(agent) => {
            setMantaAgents((prev) => [...prev, agent])
            setShowCreate(false)
            // AI: 创建后自动注入
            fetch('/api/agents/inject', { method: 'POST' })
          }}
        />
      )}
    </div>
  )
}

// ─── Manta Agent 卡片 ────────────────────────────────────────
function MantaAgentCard({ agent, isSelected, onClick }: { agent: MantaAgent; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between border rounded-lg px-3 py-2.5 transition-colors ${
        isSelected ? 'border-accent bg-accent-subtle' : 'border-accent/30 bg-accent/5 hover:border-accent/60'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-sm font-medium text-text-primary font-mono truncate block">{agent.name}</span>
          {agent.description && (
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-[260px]">{agent.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded font-mono text-text-secondary">
          {agent.targetCli}
        </span>
        <span className="text-xs px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded">Manta</span>
      </div>
    </button>
  )
}

// ─── 外部 CLI Agent 卡片 ─────────────────────────────────────
function ExternalAgentCard({ agent, isSelected, onClick }: { agent: ExternalAgent; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between border rounded-lg px-3 py-2.5 transition-colors ${
        isSelected ? 'border-accent bg-accent-subtle' : 'border-border bg-surface hover:border-accent/40'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full bg-text-muted flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-sm font-medium text-text-primary font-mono truncate block">{agent.name}</span>
          {agent.description && (
            <p className="text-xs text-text-muted mt-0.5 truncate max-w-[260px]">{agent.description}</p>
          )}
        </div>
      </div>
      <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded font-mono text-text-secondary flex-shrink-0 ml-2">
        {agent.runnerId}
      </span>
    </button>
  )
}

// ─── Manta Agent 详情 + 编辑面板 ─────────────────────────────
function MantaDetailPanel({
  agent,
  onClose,
  onSaved,
  onDeleted,
}: {
  agent: MantaAgent
  onClose: () => void
  onSaved: (updated: MantaAgent) => void
  onDeleted: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editSoul, setEditSoul] = useState(agent.soul)
  const [editDesc, setEditDesc] = useState(agent.description)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // AI: agent 切换时重置编辑状态
  useEffect(() => {
    setEditing(false)
    setEditSoul(agent.soul)
    setEditDesc(agent.description)
    setMsg(null)
    setConfirmDelete(false)
  }, [agent.name, agent.soul, agent.description])

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/agents/manta/${encodeURIComponent(agent.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul: editSoul, description: editDesc }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({ ok: true, text: '已保存，并重新注入到 CLI' })
        setEditing(false)
        onSaved(data.agent)
        // AI: 保存后自动重新注入
        fetch('/api/agents/inject', { method: 'POST' })
      } else {
        setMsg({ ok: false, text: data.error || '保存失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/agents/manta/${encodeURIComponent(agent.name)}`, { method: 'DELETE' })
      if (res.ok) {
        onDeleted(agent.name)
      }
    } catch { /* ignore */ } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-text-primary">{agent.name}</span>
          <span className="text-xs px-1.5 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded">Manta 托管</span>
          <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded font-mono text-text-muted">{agent.targetCli}</span>
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <button onClick={() => { setEditing(true); setMsg(null) }}
              className="px-3 py-1 text-xs border border-border rounded-md text-text-secondary hover:bg-accent-subtle transition-colors">
              编辑
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => { setEditing(false); setEditSoul(agent.soul); setEditDesc(agent.description); setMsg(null) }}
                className="px-3 py-1 text-xs border border-border rounded-md text-text-secondary hover:bg-accent-subtle transition-colors">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-3 py-1 text-xs bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50">
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          )}
          {/* 删除 */}
          {!editing && !confirmDelete && (
            <button onClick={() => setConfirmDelete(true)}
              className="px-2.5 py-1 text-xs border border-status-failed/30 text-status-failed rounded-md hover:bg-status-failed/5 transition-colors">
              删除
            </button>
          )}
          {confirmDelete && (
            <>
              <span className="text-xs text-status-failed">确认删除?</span>
              <button onClick={handleDelete} disabled={deleting}
                className="px-2.5 py-1 text-xs bg-status-failed text-white rounded-md disabled:opacity-50">
                {deleting ? '...' : '确认'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1 text-xs border border-border rounded-md text-text-secondary">
                取消
              </button>
            </>
          )}
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-secondary rounded transition-colors">✕</button>
        </div>
      </div>

      {/* 描述字段 */}
      <div className="px-5 py-3 border-b border-border-subtle flex-shrink-0">
        <label className="text-xs text-text-muted block mb-1">描述</label>
        {editing ? (
          <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
            className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary focus:outline-none focus:border-accent font-mono" />
        ) : (
          <p className="text-xs text-text-secondary">{agent.description || '（无描述）'}</p>
        )}
      </div>

      {/* 保存提示 */}
      {msg && (
        <div className={`px-5 py-2 text-xs flex-shrink-0 ${msg.ok ? 'text-status-done' : 'text-status-failed'}`}>
          {msg.text}
        </div>
      )}

      {/* SOUL.md 内容 */}
      <div className="px-5 py-2 border-b border-border-subtle bg-surface flex-shrink-0">
        <span className="text-xs font-mono text-text-muted">SOUL.md · 系统提示</span>
      </div>
      <div className="flex-1 overflow-auto">
        {editing ? (
          <textarea value={editSoul} onChange={(e) => setEditSoul(e.target.value)}
            className="w-full h-full p-5 text-xs font-mono bg-background text-text-primary focus:outline-none resize-none leading-relaxed"
            spellCheck={false} />
        ) : (
          <pre className="p-5 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words">
            {agent.soul || '（SOUL.md 为空）'}
          </pre>
        )}
      </div>

      {/* 元数据 */}
      <div className="px-5 py-2 border-t border-border-subtle bg-surface flex-shrink-0">
        <p className="text-xs text-text-muted">
          创建于 {new Date(agent.createdAt).toLocaleString('zh-CN')} ·
          更新于 {new Date(agent.updatedAt).toLocaleString('zh-CN')}
        </p>
      </div>
    </div>
  )
}

// ─── 外部 CLI Agent 只读详情面板 ─────────────────────────────
function ExternalDetailPanel({ agent, onClose }: { agent: ExternalAgent; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [loadingDef, setLoadingDef] = useState(false)

  useEffect(() => {
    setLoadingDef(true)
    fetch(`/api/agents/definition?name=${encodeURIComponent(agent.name)}`)
      .then((r) => r.json())
      .then((d) => setContent(d.content ?? null))
      .catch(() => setContent(null))
      .finally(() => setLoadingDef(false))
  }, [agent.name])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-text-primary">{agent.name}</span>
          <span className="text-xs px-1.5 py-0.5 bg-background border border-border rounded text-text-muted">只读</span>
        </div>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-secondary rounded transition-colors">✕</button>
      </div>
      {agent.description && (
        <div className="px-5 py-2 border-b border-border-subtle bg-surface flex-shrink-0">
          <p className="text-xs text-text-secondary">{agent.description}</p>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {loadingDef ? (
          <div className="p-6 text-sm text-text-muted">加载中...</div>
        ) : content ? (
          <pre className="p-5 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words">
            {content}
          </pre>
        ) : (
          <div className="p-6 text-sm text-text-muted">无可查看的定义文件（该 agent 由 CLI 工具直接管理）</div>
        )}
      </div>
    </div>
  )
}

// ─── 新建 Agent 弹窗 ─────────────────────────────────────────
function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (agent: MantaAgent) => void }) {
  const [form, setForm] = useState({
    name: '',
    targetCli: 'openclaw' as 'openclaw' | 'claude-code',
    description: '',
    soul: '# Agent · SOUL\n\n## 身份\n你是一个 AI Agent。\n\n## 职责\n\n## 工作流程\n',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!form.name.trim()) { setError('Agent 名称不能为空'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(form.name.trim())) {
      setError('名称只能包含字母、数字、连字符(-)和下划线(_)')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/agents/manta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (res.ok) {
        onCreated(data.agent)
      } else {
        setError(data.error || '创建失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-xl p-6 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <h2 className="text-base font-semibold text-text-primary mb-4 flex-shrink-0">新建 Manta Agent</h2>
        <div className="space-y-3 flex-shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Agent 名称 *</label>
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.replace(/\s/g, '-') })}
                placeholder="my-agent"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">目标 CLI *</label>
              <select value={form.targetCli}
                onChange={(e) => setForm({ ...form, targetCli: e.target.value as 'openclaw' | 'claude-code' })}
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent">
                <option value="openclaw">OpenClaw</option>
                <option value="claude-code">Claude Code</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述（可选）</label>
            <input type="text" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="这个 Agent 的职责..."
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
          </div>
        </div>
        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          <label className="block text-xs font-medium text-text-secondary mb-1 flex-shrink-0">
            SOUL.md · 系统提示 *
          </label>
          <textarea value={form.soul}
            onChange={(e) => setForm({ ...form, soul: e.target.value })}
            className="flex-1 min-h-[200px] px-3 py-2 text-xs font-mono border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent resize-none leading-relaxed"
            spellCheck={false} />
        </div>
        {error && <p className="text-xs text-status-failed mt-2 flex-shrink-0">{error}</p>}
        <div className="flex justify-between items-center mt-4 flex-shrink-0">
          <p className="text-xs text-text-muted">
            创建后自动保存到 ~/manta-data/agents/ 并注入到 {form.targetCli === 'openclaw' ? 'OpenClaw' : 'Claude Code'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
              取消
            </button>
            <button onClick={handleCreate} disabled={loading}
              className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50">
              {loading ? '创建中...' : '创建并注入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
/*  end: Agent 管理页结束 */
