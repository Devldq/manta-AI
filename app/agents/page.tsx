/*  start: Agent 管理页 — 紧凑布局版本，左侧列表 + 右侧详情面板 */
'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── 类型定义 ───────────────────────────────────────────────
interface MantaAgent {
  name: string
  targetCli: 'openclaw'
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
  soulEditable?: boolean
}

type SelectedAgent =
  | { type: 'manta'; agent: MantaAgent }
  | { type: 'external'; agent: ExternalAgent }

// AI: Summary 类型定义
interface ModelInfo {
  provider: string
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  capabilities: string[]
  reasoning: boolean
}

interface AgentSummary {
  type: 'openclaw'
  name: string
  models: ModelInfo[]
  isUsingDefaultModel: boolean
  defaultModel: string | null
  subagents: string[]
  workspace?: string
  extra: Record<string, unknown>
}

// AI: 格式化 contextWindow 数字，如 262144 → 256K
function fmtCtx(n?: number): string {
  if (!n) return ''
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}M ctx`
  if (n >= 1024) return `${Math.round(n / 1024)}K ctx`
  return `${n} ctx`
}

// AI: 格式化 maxTokens，如 8192 → 8K out
function fmtOut(n?: number): string {
  if (!n) return ''
  if (n >= 1024) return `${Math.round(n / 1024)}K out`
  return `${n} out`
}

const CLI_LABEL: Record<string, string> = {
  'openclaw': 'OpenClaw',
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
  // AI: 折叠状态，key 为 pluginId 或 'manta'，默认全部展开
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // AI: 模型名缓存，key 为 agent.name，value 为第一个模型的显示名（用于列表行展示）
  const [summaryCache, setSummaryCache] = useState<Record<string, string>>({})

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [mantaRes, extRes] = await Promise.all([
        fetch('/api/agents/manta'),
        fetch('/api/agents'),
      ])
      const mantaData = await mantaRes.json()
      const extData = await extRes.json()

      const manta: MantaAgent[] = mantaData.agents ?? []
      setMantaAgents(manta)
      // AI: 外部 agent 里去掉跟 manta 同名的（manta 托管的已在 Manta 区展示）
      const mantaNames = new Set(manta.map((a) => a.name))
      const ext: ExternalAgent[] = (extData.agents ?? []).filter((a: ExternalAgent) => !mantaNames.has(a.name))
      setExternalAgents(ext)
      setLastRefresh(new Date())

      // AI: 加载完成后默认选中第一个 agent（优先 external，其次 manta）
      setSelected((prev) => {
        if (prev) return prev // 已有选中则保持
        const firstExt = ext[0]
        if (firstExt) return { type: 'external', agent: firstExt }
        const firstManta = manta[0]
        if (firstManta) return { type: 'manta', agent: firstManta }
        return null
      })
    } catch {
      console.error('获取 Agent 列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // AI: 外部 agent 加载完后，异步批量加载 openclaw agents 的模型名填充 summaryCache（用于列表行展示）
  // 只对 openclaw 插件的 agent 加载，其他插件没有 models.json 数据
  useEffect(() => {
    const openclawAgents = externalAgents.filter((a) => a.pluginId === 'openclaw')
    if (openclawAgents.length === 0) return

    // AI: 并发批量加载，每个 agent 发一个 summary 请求
    Promise.allSettled(
      openclawAgents.map((agent) =>
        fetch(`/api/agents/summary?name=${encodeURIComponent(agent.name)}&pluginId=openclaw`)
          .then((r) => r.json())
          .then((d) => {
            const summary = d.summary
            if (!summary) return
            const model = summary.models?.[0]
            const modelDisplay = model ? (model.name || model.id) : (summary.defaultModel ?? null)
            if (modelDisplay) {
              setSummaryCache((prev) => ({ ...prev, [agent.name]: modelDisplay }))
            }
          })
          .catch(() => {/* 静默忽略，不影响列表渲染 */})
      )
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAgents.map((a) => a.name).join(',')])

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
    setSelected({ type: 'manta', agent })
  }

  function handleSelectExternal(agent: ExternalAgent) {
    setSelected({ type: 'external', agent })
  }

  return (
    // AI: 始终左右分栏，左侧固定宽度，右侧占满剩余空间
    <div className="flex h-full min-h-0 text-sm">
      {/* 左栏 — 固定宽度紧凑列表 */}
      <div className="w-[300px] flex-shrink-0 flex flex-col overflow-hidden border-r border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-text-primary">Agent 管理</span>
            <span className="text-xs text-text-muted whitespace-nowrap">
              {mantaAgents.length + externalAgents.length} 个
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {mantaAgents.length > 0 && (
              <button
                onClick={handleInject}
                disabled={injectStatus === 'injecting'}
                title="注入到 CLI"
                className="px-2 py-1 border border-border text-xs text-text-secondary rounded hover:bg-accent-subtle transition-colors disabled:opacity-50"
              >
                {injectStatus === 'injecting' ? '注入中' : injectStatus === 'done' ? '✓' : '↑ 注入'}
              </button>
            )}
            <button
              onClick={fetchAll}
              disabled={loading}
              title="刷新"
              className="px-2 py-1 border border-border text-xs text-text-secondary rounded hover:bg-accent-subtle transition-colors disabled:opacity-50"
            >
              <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-2 py-1 bg-accent text-text-inverse text-xs rounded hover:bg-accent-hover transition-colors"
            >
              + 新建
            </button>
          </div>
        </div>

        {/* 列表区 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-text-muted py-6 text-center">加载中...</div>
          ) : (
            <div>
              {/* Manta 托管区 */}
              <CollapsibleSection
                sectionKey="manta"
                label="Manta"
                count={mantaAgents.length}
                isAccent
                collapsed={!!collapsed['manta']}
                onToggle={() => toggleCollapse('manta')}
              >
                {mantaAgents.length === 0 ? (
                  <div className="mx-3 mb-2 border border-dashed border-border-subtle rounded p-3 text-center">
                    <p className="text-xs text-text-muted">无托管 agent</p>
                    <button onClick={() => setShowCreate(true)} className="text-xs text-accent hover:underline">新建</button>
                  </div>
                ) : (
                  <div className="pb-1">
                    {mantaAgents.map((agent) => (
                      <AgentRow
                        key={agent.name}
                        label={agent.name}
                        badge={agent.targetCli}
                        badgeStyle="accent"
                        description={agent.description}
                        isSelected={selected?.type === 'manta' && selected.agent.name === agent.name}
                        onClick={() => handleSelectManta(agent)}
                      />
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* 外部 CLI 分区 */}
              {Object.entries(byPlugin).map(([pluginId, agents]) => (
                <CollapsibleSection
                  key={pluginId}
                  sectionKey={pluginId}
                  label={CLI_LABEL[pluginId] ?? pluginId}
                  count={agents.length}
                  isAccent={false}
                  collapsed={!!collapsed[pluginId]}
                  onToggle={() => toggleCollapse(pluginId)}
                >
                  <div className="pb-1">
                    {agents.map((agent) => (
                      <AgentRow
                        key={agent.name}
                        label={agent.name}
                        badge={agent.runnerId}
                        badgeStyle="muted"
                        description={agent.description}
                        modelName={summaryCache[agent.name]}
                        isSelected={selected?.type === 'external' && selected.agent.name === agent.name}
                        onClick={() => handleSelectExternal(agent)}
                      />
                    ))}
                  </div>
                </CollapsibleSection>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="px-3 py-1.5 border-t border-border-subtle flex-shrink-0">
            <p className="text-xs text-text-muted">扫描于 {lastRefresh.toLocaleTimeString('zh-CN')}</p>
          </div>
        )}
      </div>

      {/* 右栏：详情面板 — 始终显示，不可关闭 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {selected ? (
          selected.type === 'manta' ? (
            <MantaDetailPanel
              agent={selected.agent}
              onSaved={(updated) => {
                setMantaAgents((prev) => prev.map((a) => a.name === updated.name ? updated : a))
                setSelected({ type: 'manta', agent: updated })
              }}
              onDeleted={(name) => {
                setMantaAgents((prev) => prev.filter((a) => a.name !== name))
                // AI: 删除后自动选中第一个 external agent
                const firstExt = externalAgents[0]
                if (firstExt) setSelected({ type: 'external', agent: firstExt })
                else setSelected(null)
              }}
            />
          ) : (
            <ExternalDetailPanel
              agent={selected.agent}
              onDeleted={(name) => {
                setExternalAgents((prev) => prev.filter((a) => a.name !== name))
                // AI: 删除后自动选中第一个可用 agent
                const firstManta = mantaAgents[0]
                const firstExt = externalAgents.find((a) => a.name !== name)
                if (firstManta) setSelected({ type: 'manta', agent: firstManta })
                else if (firstExt) setSelected({ type: 'external', agent: firstExt })
                else setSelected(null)
              }}
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-text-muted">选择一个 Agent 查看详情</p>
          </div>
        )}
      </div>

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

// ─── 折叠分组组件 ───────────────────────────────────────────
function CollapsibleSection({
  sectionKey,
  label,
  count,
  isAccent,
  collapsed,
  onToggle,
  children,
}: {
  sectionKey: string
  label: string
  count: number
  isAccent: boolean
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      {/* AI: 点击整行 header 触发折叠/展开 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 pt-2 pb-1 hover:bg-surface/60 transition-colors group"
      >
        {/* AI: 折叠箭头 */}
        <span className={`text-[10px] text-text-muted transition-transform duration-150 ${
          collapsed ? '-rotate-90' : 'rotate-0'
        }`}>
          ▾
        </span>
        <span className={`text-xs font-semibold uppercase tracking-wider ${
          isAccent ? 'text-accent' : 'text-text-secondary'
        }`}>
          {label}
        </span>
        <span className={`text-xs px-1 py-0.5 rounded-full leading-none ${
          isAccent
            ? 'bg-accent/10 text-accent border border-accent/20'
            : 'text-text-muted'
        }`}>
          {count}
        </span>
      </button>
      {/* AI: 折叠内容区，使用 grid-rows 实现平滑动画 */}
      <div className={`grid transition-all duration-200 ${
        collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      }`}>
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── 通用紧凑行组件 ──────────────────────────────────────────
/* AI start: AgentRow 增加第二行：简介（截断20字）+ 模型名 */
function AgentRow({
  label,
  badge,
  badgeStyle,
  tooltip,
  description,
  modelName,
  isSelected,
  onClick,
}: {
  label: string
  badge: string
  badgeStyle: 'accent' | 'muted'
  tooltip?: string
  description?: string
  modelName?: string
  isSelected: boolean
  onClick: () => void
}) {
  // AI: 简介截断为约20字
  const shortDesc = description ? (description.length > 20 ? description.slice(0, 20) + '…' : description) : ''

  return (
    <button
      onClick={onClick}
      title={tooltip || description}
      className={`w-full text-left flex items-start gap-2 px-3 py-1.5 transition-colors group ${
        isSelected
          ? 'bg-accent/10 text-text-primary'
          : 'text-text-secondary hover:bg-surface hover:text-text-primary'
      }`}
    >
      <div className={`w-1 h-1 rounded-full flex-shrink-0 mt-1.5 ${badgeStyle === 'accent' ? 'bg-accent' : 'bg-text-muted'}`} />
      <div className="flex-1 min-w-0">
        {/* 第一行：名称 + badge */}
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-xs font-mono truncate">{label}</span>
          <span className={`text-[10px] px-1 py-0.5 rounded font-mono flex-shrink-0 ${
            badgeStyle === 'accent'
              ? 'bg-accent/10 text-accent border border-accent/20'
              : 'bg-surface border border-border text-text-muted'
          }`}>
            {badge}
          </span>
        </div>
        {/* 第二行：简介 + 模型名（任意一个有值时才显示） */}
        {(shortDesc || modelName) && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {shortDesc && (
              <span className="text-[10px] text-text-muted truncate flex-1 leading-tight">{shortDesc}</span>
            )}
            {modelName && (
              <span className="text-[10px] font-mono text-text-muted bg-surface/80 border border-border-subtle px-1 py-0.5 rounded flex-shrink-0 leading-tight">
                {modelName}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
/* AI end: AgentRow 扩展结束 */

// ─── Manta Agent 详情 + 编辑面板 ─────────────────────────────
function MantaDetailPanel({
  agent,
  onSaved,
  onDeleted,
}: {
  agent: MantaAgent
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
  // AI: 润色相关状态
  const [polishing, setPolishing] = useState(false)
  const [showPolishHelper, setShowPolishHelper] = useState(false)
  const [polishInput, setPolishInput] = useState({ responsibilities: '', workflow: '' })

  // AI: agent 切换时重置编辑状态
  useEffect(() => {
    setEditing(false)
    setEditSoul(agent.soul)
    setEditDesc(agent.description)
    setMsg(null)
    setConfirmDelete(false)
    setShowPolishHelper(false)
    setPolishInput({ responsibilities: '', workflow: '' })
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
        setMsg({ ok: true, text: '已保存' })
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

  // AI: 调用 AI 润色接口（优先外部 API，降级到 OpenClaw）
  async function handlePolish() {
    setPolishing(true)
    setMsg(null)
    try {
      // AI: 准备请求数据
      const requestData = {
        name: agent.name,
        description: editDesc || undefined,
        responsibilities: polishInput.responsibilities || undefined,
        workflow: polishInput.workflow || undefined,
        currentSoul: editSoul,
      }

      // AI: Step 1 - 优先尝试外部 API
      let res = await fetch('/api/agents/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })

      // AI: Step 2 - 如果外部 API 失败（未配置 Key），降级到 OpenClaw
      if (!res.ok) {
        const errorData = await res.json()
        if (errorData.error && errorData.error.includes('NO_API_KEY')) {
          console.log('[polish] 外部 API 未配置，降级到 OpenClaw')
          res = await fetch('/api/agents/polish-openclaw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData),
          })
        }
      }

      const data = await res.json()
      if (data.success) {
        setEditSoul(data.soul)
        setPolishInput({ responsibilities: '', workflow: '' })
        setShowPolishHelper(false)
        setMsg({ ok: true, text: '✓ AI 润色完成' })
      } else {
        setMsg({ ok: false, text: data.error || 'AI 润色失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setPolishing(false)
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
      {/* Header — 紧凑 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-xs font-semibold text-text-primary truncate">{agent.name}</span>
          <span className="text-[10px] px-1 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded flex-shrink-0">Manta</span>
          <span className="text-[10px] px-1 py-0.5 bg-surface border border-border rounded font-mono text-text-muted flex-shrink-0">{agent.targetCli}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!editing && !confirmDelete && (
            <>
              <button onClick={() => { setEditing(true); setMsg(null) }}
                className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary hover:bg-accent-subtle transition-colors">
                编辑
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="px-2 py-0.5 text-xs border border-status-failed/30 text-status-failed rounded hover:bg-status-failed/5 transition-colors">
                删除
              </button>
            </>
          )}
          {editing && (
            <>
              <button onClick={() => { setEditing(false); setEditSoul(agent.soul); setEditDesc(agent.description); setMsg(null) }}
                className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary hover:bg-accent-subtle transition-colors">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-2 py-0.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
                {saving ? '保存中...' : '保存'}
              </button>
            </>
          )}
          {confirmDelete && (
            <>
              <span className="text-xs text-status-failed">确认?</span>
              <button onClick={handleDelete} disabled={deleting}
                className="px-2 py-0.5 text-xs bg-status-failed text-white rounded disabled:opacity-50">
                {deleting ? '...' : '删除'}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary">
                取消
              </button>
            </>
          )}
        </div>
      </div>

      {/* 描述字段 — 单行内联 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle flex-shrink-0">
        <span className="text-xs text-text-muted flex-shrink-0">描述</span>
        {editing ? (
          <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
            className="flex-1 px-2 py-0.5 text-xs border border-border rounded bg-surface text-text-primary focus:outline-none focus:border-accent font-mono" />
        ) : (
          <p className="text-xs text-text-secondary truncate">{agent.description || '（无）'}</p>
        )}
      </div>

      {/* 状态消息 */}
      {msg && (
        <div className={`px-3 py-1 text-xs flex-shrink-0 ${msg.ok ? 'text-status-done' : 'text-status-failed'}`}>
          {msg.text}
        </div>
      )}

      {/* SOUL 内容 */}
      <div className="flex-1 overflow-auto flex flex-col">
        {editing ? (
          <>
            {/* AI: AI 润色辅助区（编辑模式下显示）*/}
            {showPolishHelper && (
              <div className="border-b border-accent/20 bg-accent/5 flex-shrink-0">
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-accent">✨ AI 润色助手</span>
                    <button
                      onClick={() => setShowPolishHelper(false)}
                      className="text-xs text-text-muted hover:text-text-primary"
                    >
                      收起
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">补充职责（可选）</label>
                    <textarea
                      value={polishInput.responsibilities}
                      onChange={(e) => setPolishInput({ ...polishInput, responsibilities: e.target.value })}
                      placeholder="补充 Agent 的职责说明..."
                      className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-secondary mb-1">补充流程（可选）</label>
                    <textarea
                      value={polishInput.workflow}
                      onChange={(e) => setPolishInput({ ...polishInput, workflow: e.target.value })}
                      placeholder="补充工作流程说明..."
                      className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                      rows={2}
                    />
                  </div>
                  <button
                    onClick={handlePolish}
                    disabled={polishing}
                    className="w-full px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {polishing ? '✨ AI 优化中...' : '✨ AI 优化 SOUL.md'}
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-surface/50 flex-shrink-0">
              <span className="text-[10px] font-mono text-text-muted">编辑 SOUL.md</span>
              {!showPolishHelper && (
                <button
                  onClick={() => setShowPolishHelper(true)}
                  className="text-[10px] text-accent hover:underline"
                >
                  ✨ AI 润色
                </button>
              )}
            </div>
            <textarea value={editSoul} onChange={(e) => setEditSoul(e.target.value)}
              className="flex-1 p-3 text-xs font-mono bg-background text-text-primary focus:outline-none resize-none leading-relaxed"
              spellCheck={false} />
          </>
        ) : (
          <>
            <div className="px-3 py-1 border-b border-border-subtle bg-surface flex-shrink-0">
              <span className="text-[10px] font-mono text-text-muted">SOUL.md</span>
            </div>
            <pre className="flex-1 p-3 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words overflow-auto">
              {agent.soul || '（SOUL.md 为空）'}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 摘要信息卡片 ────────────────────────────────────────────
function SummaryCard({ summary }: { summary: AgentSummary }) {
  const model = summary.models[0]
  const tools = (summary.extra?.tools as string[] | undefined) ?? []
  const extraDesc = summary.extra?.description as string | undefined

  return (
    <div className="px-3 py-2 border-b border-border-subtle bg-surface/50 flex-shrink-0 space-y-1.5">
      {/* 模型信息行 */}
      {model ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-text-muted">模型</span>
          <span className="text-xs font-mono font-medium text-text-primary">{model.name || model.id}</span>
          {model.provider && (
            <span className="text-[10px] px-1 py-0.5 bg-surface border border-border rounded text-text-muted">{model.provider}</span>
          )}
          {model.reasoning && (
            <span className="text-[10px] px-1 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded">推理</span>
          )}
          {fmtCtx(model.contextWindow) && (
            <span className="text-[10px] text-text-muted">{fmtCtx(model.contextWindow)}</span>
          )}
          {fmtOut(model.maxTokens) && (
            <span className="text-[10px] text-text-muted">{fmtOut(model.maxTokens)}</span>
          )}
          {/* 输入能力 */}
          {model.capabilities.filter(c => c !== 'text').map(c => (
            <span key={c} className="text-[10px] px-1 py-0.5 bg-surface border border-border rounded text-text-muted">{c}</span>
          ))}
          {summary.isUsingDefaultModel && (
            <span className="text-[10px] text-text-muted opacity-60">（继承全局默认）</span>
          )}
        </div>
      ) : summary.defaultModel ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted">模型</span>
          <span className="text-xs font-mono text-text-secondary">{summary.defaultModel}</span>
          <span className="text-[10px] text-text-muted opacity-60">（系统默认）</span>
        </div>
      ) : null}

      {/* Sub-agents 行 */}
      {summary.subagents.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-text-muted">Sub-agents</span>
          {summary.subagents.map(s => (
            <span key={s} className="text-[10px] px-1 py-0.5 font-mono bg-accent/5 border border-accent/20 text-accent rounded">{s}</span>
          ))}
        </div>
      )}

      {/* Tools 行（claude-code） */}
      {tools.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-text-muted">Tools</span>
          {tools.slice(0, 8).map(t => (
            <span key={t} className="text-[10px] px-1 py-0.5 font-mono bg-surface border border-border text-text-secondary rounded">{t}</span>
          ))}
          {tools.length > 8 && <span className="text-[10px] text-text-muted">+{tools.length - 8}</span>}
        </div>
      )}

      {/* 额外描述（非 agent.description 覆盖的补充） */}
      {extraDesc && !tools.length && (
        <p className="text-[10px] text-text-muted leading-relaxed">{extraDesc}</p>
      )}

      {/* Workspace */}
      {summary.workspace && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted">Workspace</span>
          <span className="text-[10px] font-mono text-text-secondary truncate">{summary.workspace.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
      )}
    </div>
  )
}

// ─── 外部 CLI Agent 详情面板（支持编辑 SOUL.md）─────────────────────────────
function ExternalDetailPanel({ agent, onDeleted }: { agent: ExternalAgent; onDeleted: (name: string) => void }) {
  const [content, setContent] = useState<string | null>(null)
  const [loadingDef, setLoadingDef] = useState(false)
  const [summary, setSummary] = useState<AgentSummary | null>(null)
  
  // AI: 编辑相关状态
  const [soul, setSoul] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [editingSoul, setEditingSoul] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadingSoul, setLoadingSoul] = useState(false)
  // AI: 润色相关状态
  const [polishing, setPolishing] = useState(false)
  const [showPolishHelper, setShowPolishHelper] = useState(false)
  const [polishInput, setPolishInput] = useState({ responsibilities: '', workflow: '' })
  // AI: 删除相关状态
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    // AI: 并行加载 summary 和 definition
    setSummary(null)
    setLoadingDef(true)
    setShowPolishHelper(false)
    setPolishInput({ responsibilities: '', workflow: '' })
    Promise.all([
      fetch(`/api/agents/summary?name=${encodeURIComponent(agent.name)}&pluginId=${encodeURIComponent(agent.pluginId ?? '')}`)
        .then(r => r.json()).then(d => d.summary ?? null).catch(() => null),
      fetch(`/api/agents/definition?name=${encodeURIComponent(agent.name)}`)
        .then((r) => r.json()).then((d) => d.content ?? null).catch(() => null),
    ]).then(([sum, def]) => {
      setSummary(sum)
      setContent(def)
    }).finally(() => setLoadingDef(false))

    // AI: 如果支持编辑 SOUL，加载 SOUL.md
    if (agent.soulEditable && agent.pluginId === 'openclaw') {
      setLoadingSoul(true)
      fetch(`/api/agents/openclaw/${encodeURIComponent(agent.name)}/soul`)
        .then(r => r.json())
        .then(d => {
          if (d.soul) {
            setSoul(d.soul)
            setEditingSoul(d.soul)
          }
        })
        .catch(() => {})
        .finally(() => setLoadingSoul(false))
    }
  }, [agent.name, agent.pluginId, agent.soulEditable])

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/agents/openclaw/${encodeURIComponent(agent.name)}/soul`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul: editingSoul }),
      })
      const data = await res.json()
      if (data.success) {
        setSoul(editingSoul)
        setEditing(false)
        setMsg({ ok: true, text: '✓ 已保存' })
      } else {
        setMsg({ ok: false, text: data.error || '保存失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setSaving(false)
    }
  }

  // AI: 调用 AI 润色接口（优先外部 API，降级到 OpenClaw）
  async function handlePolish() {
    setPolishing(true)
    setMsg(null)
    try {
      // AI: 准备请求数据
      const requestData = {
        name: agent.name,
        description: agent.description || undefined,
        responsibilities: polishInput.responsibilities || undefined,
        workflow: polishInput.workflow || undefined,
        currentSoul: editingSoul,
      }

      // AI: Step 1 - 优先尝试外部 API
      let res = await fetch('/api/agents/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })

      // AI: Step 2 - 如果外部 API 失败（未配置 Key），降级到 OpenClaw
      if (!res.ok) {
        const errorData = await res.json()
        if (errorData.error && errorData.error.includes('NO_API_KEY')) {
          console.log('[polish] 外部 API 未配置，降级到 OpenClaw')
          res = await fetch('/api/agents/polish-openclaw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData),
          })
        }
      }

      const data = await res.json()
      if (data.success) {
        setEditingSoul(data.soul)
        setPolishInput({ responsibilities: '', workflow: '' })
        setShowPolishHelper(false)
        setMsg({ ok: true, text: '✓ AI 润色完成' })
      } else {
        setMsg({ ok: false, text: data.error || 'AI 润色失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setPolishing(false)
    }
  }

  // AI: 删除 openclaw agent
  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/agents/openclaw/${encodeURIComponent(agent.name)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onDeleted(agent.name)
      } else {
        const data = await res.json()
        setMsg({ ok: false, text: data.error || '删除失败' })
      }
    } catch {
      setMsg({ ok: false, text: '网络错误' })
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-mono text-xs font-semibold text-text-primary truncate">{agent.name}</span>
          {agent.soulEditable ? (
            <span className="text-[10px] px-1 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded flex-shrink-0">可编辑</span>
          ) : (
            <span className="text-[10px] px-1 py-0.5 bg-surface border border-border rounded text-text-muted flex-shrink-0">只读</span>
          )}
          {agent.pluginId && (
            <span className="text-[10px] px-1 py-0.5 bg-surface border border-border rounded font-mono text-text-muted flex-shrink-0">{agent.pluginId}</span>
          )}
        </div>
        
        {/* AI: 编辑按钮（仅当 soulEditable 为 true 时显示）*/}
        {agent.soulEditable && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {!editing && !confirmDelete && (
              <>
                <button onClick={() => { setEditing(true); setMsg(null) }}
                  className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary hover:bg-accent-subtle transition-colors">
                  编辑
                </button>
                <button onClick={() => setConfirmDelete(true)}
                  className="px-2 py-0.5 text-xs border border-status-failed/30 text-status-failed rounded hover:bg-status-failed/5 transition-colors">
                  删除
                </button>
              </>
            )}
            {editing && !confirmDelete && (
              <>
                <button onClick={() => { setEditing(false); setEditingSoul(soul); setMsg(null) }}
                  className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary hover:bg-accent-subtle transition-colors">
                  取消
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="px-2 py-0.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
              </>
            )}
            {confirmDelete && (
              <>
                <span className="text-xs text-status-failed">确认删除?</span>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-2 py-0.5 text-xs bg-status-failed text-white rounded disabled:opacity-50">
                  {deleting ? '...' : '删除'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-2 py-0.5 text-xs border border-border rounded text-text-secondary">
                  取消
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 描述 */}
      {agent.description && (
        <div className="px-3 py-1.5 border-b border-border-subtle flex-shrink-0">
          <p className="text-xs text-text-secondary">{agent.description}</p>
        </div>
      )}

      {/* 状态消息 */}
      {msg && (
        <div className={`px-3 py-1 text-xs flex-shrink-0 ${msg.ok ? 'text-status-done' : 'text-status-failed'}`}>
          {msg.text}
        </div>
      )}

      {/* AI: Summary 摘要卡片 — 默认展示模型、工具、sub-agents 等关键信息 */}
      {summary && <SummaryCard summary={summary} />}

      {/* AI: SOUL.md 编辑区域（如果支持编辑）*/}
      {agent.soulEditable ? (
        <div className="flex-1 overflow-auto flex flex-col">
          {editing && showPolishHelper && (
            <div className="border-b border-accent/20 bg-accent/5 flex-shrink-0">
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-accent">✨ AI 润色助手</span>
                  <button
                    onClick={() => setShowPolishHelper(false)}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    收起
                  </button>
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">补充职责（可选）</label>
                  <textarea
                    value={polishInput.responsibilities}
                    onChange={(e) => setPolishInput({ ...polishInput, responsibilities: e.target.value })}
                    placeholder="补充 Agent 的职责说明..."
                    className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-secondary mb-1">补充流程（可选）</label>
                  <textarea
                    value={polishInput.workflow}
                    onChange={(e) => setPolishInput({ ...polishInput, workflow: e.target.value })}
                    placeholder="补充工作流程说明..."
                    className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                    rows={2}
                  />
                </div>
                <button
                  onClick={handlePolish}
                  disabled={polishing}
                  className="w-full px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {polishing ? '✨ AI 优化中...' : '✨ AI 优化 SOUL.md'}
                </button>
              </div>
            </div>
          )}
          <div className="px-3 py-1 bg-surface border-b border-border-subtle flex-shrink-0 flex items-center justify-between">
            <span className="text-[10px] font-mono text-text-muted">{editing ? '编辑 SOUL.md' : 'SOUL.md'}</span>
            {editing && !showPolishHelper && (
              <button
                onClick={() => setShowPolishHelper(true)}
                className="text-[10px] text-accent hover:underline"
              >
                ✨ AI 润色
              </button>
            )}
          </div>
          {loadingSoul ? (
            <div className="p-4 text-xs text-text-muted">加载中...</div>
          ) : editing ? (
            <textarea value={editingSoul} onChange={(e) => setEditingSoul(e.target.value)}
              className="flex-1 p-3 text-xs font-mono bg-background text-text-primary focus:outline-none resize-none leading-relaxed"
              spellCheck={false} />
          ) : (
            <pre className="flex-1 p-3 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words overflow-auto">
              {soul || '（SOUL.md 为空）'}
            </pre>
          )}
        </div>
      ) : (
        /* AI: 原始定义文件内容（只读模式）*/
        <div className="flex-1 overflow-auto">
          {loadingDef ? (
            <div className="p-4 text-xs text-text-muted">加载中...</div>
          ) : content ? (
            <>
              <div className="px-3 py-1 bg-surface border-b border-border-subtle flex-shrink-0">
                <span className="text-[10px] font-mono text-text-muted">原始定义</span>
              </div>
              <pre className="p-3 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap break-words">
                {content}
              </pre>
            </>
          ) : (
            <div className="p-4 text-xs text-text-muted">（该 agent 由 CLI 工具直接管理，无单独定义文件）</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 新建 Agent 弹窗 ─────────────────────────────────────────
function CreateAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (agent: MantaAgent) => void }) {
  const [form, setForm] = useState({
    name: '',
    targetCli: 'openclaw' as 'openclaw',
    description: '',
    soul: '# Agent · SOUL\n\n## 身份\n你是一个 AI Agent。\n\n## 职责\n\n## 工作流程\n',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // AI: 润色相关状态
  const [polishing, setPolishing] = useState(false)
  const [polishInput, setPolishInput] = useState({
    responsibilities: '',
    workflow: '',
  })

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

  // AI: 调用 AI 润色接口（优先外部 API，降级到 OpenClaw）
  async function handlePolish() {
    setPolishing(true)
    setError('')
    try {
      // AI: 准备请求数据
      const requestData = {
        name: form.name || undefined,
        description: form.description || undefined,
        responsibilities: polishInput.responsibilities || undefined,
        workflow: polishInput.workflow || undefined,
        currentSoul: form.soul !== '# Agent · SOUL\n\n## 身份\n你是一个 AI Agent。\n\n## 职责\n\n## 工作流程\n' ? form.soul : undefined,
      }

      // AI: Step 1 - 优先尝试外部 API
      let res = await fetch('/api/agents/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })

      // AI: Step 2 - 如果外部 API 失败（未配置 Key），降级到 OpenClaw
      if (!res.ok) {
        const errorData = await res.json()
        if (errorData.error && errorData.error.includes('NO_API_KEY')) {
          console.log('[polish] 外部 API 未配置，降级到 OpenClaw')
          res = await fetch('/api/agents/polish-openclaw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData),
          })
        }
      }

      const data = await res.json()
      if (data.success) {
        setForm({ ...form, soul: data.soul })
        // AI: 清空辅助输入
        setPolishInput({ responsibilities: '', workflow: '' })
      } else {
        setError(data.error || 'AI 润色失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-xl p-5 w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
        <h2 className="text-sm font-semibold text-text-primary mb-3 flex-shrink-0">新建 Manta Agent</h2>
        
        {/* AI: 基础信息区 */}
        <div className="space-y-2 flex-shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">名称 *</label>
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value.replace(/\s/g, '-') })}
                placeholder="my-agent"
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">目标 CLI *</label>
              <div className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary">
                OpenClaw
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述（可选）</label>
            <input type="text" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="这个 Agent 的职责..."
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
          </div>
        </div>

        {/* AI: AI 润色辅助区（可折叠）*/}
        <div className="mt-3 border border-accent/20 rounded-lg bg-accent/5 flex-shrink-0">
          <div className="px-3 py-2 border-b border-accent/20 bg-accent/10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-accent">✨ AI 润色助手</span>
              <span className="text-[10px] text-text-muted">描述你的想法，让 AI 帮你生成完整 SOUL.md</span>
            </div>
          </div>
          <div className="p-3 space-y-2">
            <div>
              <label className="block text-xs text-text-secondary mb-1">核心职责（可选）</label>
              <textarea
                value={polishInput.responsibilities}
                onChange={(e) => setPolishInput({ ...polishInput, responsibilities: e.target.value })}
                placeholder="例如：负责代码审查、自动修复常见问题、生成测试报告..."
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                rows={2}
              />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1">工作流程（可选）</label>
              <textarea
                value={polishInput.workflow}
                onChange={(e) => setPolishInput({ ...polishInput, workflow: e.target.value })}
                placeholder="例如：1. 接收代码变更 2. 运行静态分析 3. 自动修复 4. 生成报告..."
                className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                rows={2}
              />
            </div>
            <button
              onClick={handlePolish}
              disabled={polishing || (!form.name && !form.description && !polishInput.responsibilities && !polishInput.workflow)}
              className="w-full px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {polishing ? '✨ AI 生成中...' : '✨ AI 生成 SOUL.md'}
            </button>
          </div>
        </div>

        {/* AI: SOUL.md 编辑区 */}
        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          <label className="block text-xs font-medium text-text-secondary mb-1 flex-shrink-0">SOUL.md *</label>
          <textarea value={form.soul}
            onChange={(e) => setForm({ ...form, soul: e.target.value })}
            className="flex-1 min-h-[200px] px-3 py-2 text-xs font-mono border border-border rounded bg-surface text-text-primary focus:outline-none focus:border-accent resize-none leading-relaxed"
            spellCheck={false} />
        </div>

        {error && <p className="text-xs text-status-failed mt-2 flex-shrink-0">{error}</p>}
        
        <div className="flex justify-between items-center mt-3 flex-shrink-0">
          <p className="text-xs text-text-muted">
            保存到 ~/manta-data/agents/ 并注入到 {form.targetCli === 'openclaw' ? 'OpenClaw' : 'Claude Code'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors">
              取消
            </button>
            <button onClick={handleCreate} disabled={loading}
              className="px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50">
              {loading ? '创建中...' : '创建并注入'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
/*  end: Agent 管理页结束 */
