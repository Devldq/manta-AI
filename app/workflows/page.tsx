/*  start: 工作流编排页 — 查看流程图 + 执行状态 + 可视化编辑器 */
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── 类型定义 ───────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'
type WorkflowExecutionStatus = 'running' | 'waiting' | 'done' | 'failed'
type WorkflowStepType = 'agent' | 'human_in_loop' | 'parallel' | 'conditional' | 'loop'
type EditMode = 'view' | 'visual' | 'yaml'

interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  agentName?: string
  next?: string
  actions?: Record<string, string>
  notify?: boolean
  branches?: WorkflowStep[]
}

interface WorkflowDef {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  latestExecution?: WorkflowExecution | null
}

interface StepLog {
  stepId: string
  stepName: string
  status: StepStatus
  agentName?: string
  startedAt?: string
  completedAt?: string
  error?: string
  actions?: Record<string, string>
}

interface WorkflowExecution {
  taskId: string
  workflowId: string
  status: WorkflowExecutionStatus
  currentStepId?: string
  steps: StepLog[]
  context: Record<string, unknown>
  createdAt: string
  updatedAt: string
  // AI: 来自 API 附加的关联任务标题
  taskTitle?: string | null
}

// ─── 可视化编辑器内部数据模型 ───────────────────────────────────────────────

interface DraftAction {
  key: string
  target: string
}

interface DraftBranch {
  name: string
  agentName: string
}

interface DraftStep {
  id: string
  type: WorkflowStepType
  name: string
  agentName: string
  next: string
  notify: boolean
  actions: DraftAction[]
  branches: DraftBranch[]
}

interface DraftWorkflow {
  id: string
  name: string
  description: string
  steps: DraftStep[]
}

// ─── WorkflowDef → DraftWorkflow 转换 ───────────────────────────────────────

function defToDraft(wf: WorkflowDef): DraftWorkflow {
  return {
    id: wf.id,
    name: wf.name,
    description: wf.description ?? '',
    steps: wf.steps.map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
      agentName: s.agentName ?? '',
      next: s.next ?? '',
      notify: s.notify === true,
      actions: s.actions
        ? Object.entries(s.actions).map(([key, target]) => ({ key, target }))
        : [],
      branches: s.branches
        ? s.branches.map((b) => ({ name: b.name, agentName: b.agentName ?? '' }))
        : [],
    })),
  }
}

// ─── DraftWorkflow → YAML 序列化 ───────────────────────────────────────────

// AI: 生成缩进字符串
function indent(level: number): string {
  return '  '.repeat(level)
}

// AI: 安全转义 YAML 字符串值（包含特殊字符时加引号）
function yamlStr(s: string): string {
  if (!s) return '""'
  if (/[:#\[\]{}&*!|>'"%@`,\n\r]/.test(s) || s.includes('  ')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

function draftToYaml(draft: DraftWorkflow): string {
  const lines: string[] = []

  lines.push(`name: ${yamlStr(draft.name)}`)
  lines.push(`id: ${yamlStr(draft.id)}`)
  if (draft.description) {
    lines.push(`description: ${yamlStr(draft.description)}`)
  }
  lines.push('')
  lines.push('steps:')

  for (const step of draft.steps) {
    lines.push(`${indent(1)}- id: ${yamlStr(step.id)}`)

    if (step.type === 'parallel') {
      lines.push(`${indent(2)}parallel: true`)
    } else if (step.type !== 'agent') {
      lines.push(`${indent(2)}type: ${step.type}`)
    }

    lines.push(`${indent(2)}name: ${yamlStr(step.name)}`)

    // AI: agent 字段（agent 类型用 agent:，其余用 agentName:）
    if (step.type === 'agent' && step.agentName) {
      lines.push(`${indent(2)}agent: ${yamlStr(step.agentName)}`)
    }

    // AI: next 字段
    if (step.next && step.type !== 'parallel') {
      lines.push(`${indent(2)}next: ${yamlStr(step.next)}`)
    }

    // AI: notify
    if (step.notify) {
      lines.push(`${indent(2)}notify: mac_notification`)
    }

    // AI: actions（human_in_loop）
    if (step.actions.length > 0) {
      lines.push(`${indent(2)}actions:`)
      for (const action of step.actions) {
        if (action.key && action.target) {
          lines.push(`${indent(3)}${yamlStr(action.key)}: ${yamlStr(action.target)}`)
        }
      }
    }

    // AI: branches（parallel）
    if (step.type === 'parallel' && step.branches.length > 0) {
      lines.push(`${indent(2)}branches:`)
      for (const branch of step.branches) {
        lines.push(`${indent(3)}- agent: ${yamlStr(branch.agentName)}`)
        if (branch.name) {
          lines.push(`${indent(4)}name: ${yamlStr(branch.name)}`)
        }
      }
      // AI: after_all 指向下一步
      if (step.next) {
        lines.push(`${indent(2)}after_all: ${yamlStr(step.next)}`)
      }
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ─── 辅助工具函数 ───────────────────────────────────────────────

// AI: 生成唯一 step id（kebab-case）
function genStepId(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'step'
  let id = base
  let i = 2
  while (existingIds.includes(id)) {
    id = `${base}_${i++}`
  }
  return id
}

// AI: 默认新步骤
function newDraftStep(existingIds: string[]): DraftStep {
  const id = genStepId('new_step', existingIds)
  return {
    id,
    type: 'agent',
    name: '新步骤',
    agentName: '',
    next: '',
    notify: false,
    actions: [],
    branches: [],
  }
}

function fmtDuration(start?: string, end?: string): string {
  if (!start) return ''
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const ms = e - s
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`
}

// ─── 样式常量 ───────────────────────────────────────────────

const STEP_STATUS_STYLE: Record<StepStatus, { dot: string; text: string; label: string }> = {
  pending:  { dot: 'bg-border',                        text: 'text-text-muted',     label: '待执行' },
  running:  { dot: 'bg-status-running animate-pulse',  text: 'text-status-running', label: '执行中' },
  waiting:  { dot: 'bg-yellow-400 animate-pulse',      text: 'text-yellow-500',     label: '等待操作' },
  done:     { dot: 'bg-status-done',                   text: 'text-status-done',    label: '完成' },
  failed:   { dot: 'bg-status-failed',                 text: 'text-status-failed',  label: '失败' },
  skipped:  { dot: 'bg-border opacity-40',             text: 'text-text-muted',     label: '已跳过' },
}

const EXEC_STATUS_BADGE: Record<WorkflowExecutionStatus, string> = {
  running: 'bg-blue-50 text-blue-600 border-blue-200',
  waiting: 'bg-yellow-50 text-yellow-600 border-yellow-200',
  done:    'bg-green-50 text-green-600 border-green-200',
  failed:  'bg-red-50 text-red-600 border-red-200',
}

const STEP_TYPE_ICON: Record<WorkflowStepType, string> = {
  agent:         '◉',
  human_in_loop: '◈',
  parallel:      '⊞',
  conditional:   '◇',
  loop:          '↺',
}

const STEP_TYPE_LABEL: Record<WorkflowStepType, string> = {
  agent:         'Agent',
  human_in_loop: 'Human',
  parallel:      'Parallel',
  conditional:   'Cond',
  loop:          'Loop',
}

const STEP_TYPE_COLOR: Record<WorkflowStepType, string> = {
  agent:         'border-border bg-background',
  human_in_loop: 'border-yellow-200 bg-yellow-50',
  parallel:      'border-blue-200 bg-blue-50',
  conditional:   'border-purple-200 bg-purple-50',
  loop:          'border-green-200 bg-green-50',
}

const STEP_TYPE_ICON_COLOR: Record<WorkflowStepType, string> = {
  agent:         'text-text-muted',
  human_in_loop: 'text-yellow-500',
  parallel:      'text-blue-500',
  conditional:   'text-purple-500',
  loop:          'text-green-500',
}

// ─── 主页面 ─────────────────────────────────────────────────

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([])
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [selected, setSelected] = useState<WorkflowDef | null>(null)
  const [selectedExec, setSelectedExec] = useState<WorkflowExecution | null>(null)
  const selectedExecRef = useRef<WorkflowExecution | null>(null)

  function selectExec(exec: WorkflowExecution | null) {
    selectedExecRef.current = exec
    setSelectedExec(exec)
  }
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  // AI: 编辑模式：view / visual / yaml
  const [editMode, setEditMode] = useState<EditMode>('view')

  // AI: YAML 编辑状态
  const [yamlContent, setYamlContent] = useState('')
  const [yamlSaving, setYamlSaving] = useState(false)
  const [yamlError, setYamlError] = useState('')

  // AI: 可视化编辑 draft 状态
  const [draft, setDraft] = useState<DraftWorkflow | null>(null)
  const [visualSaving, setVisualSaving] = useState(false)
  const [visualError, setVisualError] = useState('')

  // AI: 已加载的 agent 选项列表（供步骤编辑下拉用）
  const [agentOptions, setAgentOptions] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((d) => {
        const names: string[] = (d.agents ?? []).map((a: { name?: string; id?: string }) => a.name ?? a.id ?? '')
        setAgentOptions(names.filter(Boolean))
      })
      .catch(() => {})
  }, [])

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows')
      const data = await res.json()
      setWorkflows(data.workflows ?? [])
    } catch {
      console.error('获取工作流失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch('/api/workflows/executions')
      const data = await res.json()
      const all: WorkflowExecution[] = data.executions ?? []
      setExecutions(all)
      if (selectedExecRef.current) {
        const updated = all.find((e) => e.taskId === selectedExecRef.current!.taskId)
        if (updated) selectExec(updated)
      }
    } catch {
      console.error('获取执行实例失败')
    }
  }, [])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])
  useEffect(() => {
    fetchExecutions()
    const timer = setInterval(fetchExecutions, 3000)
    return () => clearInterval(timer)
  }, [fetchExecutions])

  // AI: 切换编辑模式
  async function enterEditMode(mode: EditMode) {
    if (!selected) return
    if (mode === 'yaml') {
      try {
        const res = await fetch(`/api/workflows/def/${selected.id}/yaml`)
        const data = await res.json()
        setYamlContent(data.yaml ?? '')
        setYamlError('')
      } catch {
        setYamlContent('')
        setYamlError('加载 YAML 失败')
      }
    }
    if (mode === 'visual') {
      setDraft(defToDraft(selected))
      setVisualError('')
    }
    setEditMode(mode)
  }

  function exitEditMode() {
    setEditMode('view')
    setDraft(null)
    setYamlContent('')
    setYamlError('')
    setVisualError('')
  }

  // AI: 保存 YAML
  async function saveYaml() {
    if (!selected || !yamlContent.trim()) {
      setYamlError('YAML 内容不能为空')
      return
    }
    setYamlSaving(true)
    setYamlError('')
    try {
      const res = await fetch(`/api/workflows/def/${selected.id}/yaml`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: yamlContent }),
      })
      const data = await res.json()
      if (!res.ok) { setYamlError(data.error ?? '保存失败'); return }
      await fetchWorkflows()
      exitEditMode()
    } catch {
      setYamlError('网络错误')
    } finally {
      setYamlSaving(false)
    }
  }

  // AI: 保存可视化编辑 draft
  async function saveDraft() {
    if (!selected || !draft) return

    // AI: 校验：所有步骤 ID 不能为空且不能重复
    const ids = draft.steps.map((s) => s.id.trim())
    if (ids.some((id) => !id)) { setVisualError('存在步骤 ID 为空，请填写'); return }
    const dupId = ids.find((id, i) => ids.indexOf(id) !== i)
    if (dupId) { setVisualError(`步骤 ID 重复：${dupId}`); return }
    if (!draft.name.trim()) { setVisualError('工作流名称不能为空'); return }

    setVisualSaving(true)
    setVisualError('')
    try {
      const yaml = draftToYaml(draft)
      const res = await fetch(`/api/workflows/def/${draft.id}/yaml`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      })
      const data = await res.json()
      if (!res.ok) { setVisualError(data.error ?? '保存失败'); return }
      await fetchWorkflows()
      exitEditMode()
    } catch {
      setVisualError('网络错误')
    } finally {
      setVisualSaving(false)
    }
  }

  async function handleHumanAction(taskId: string, actionKey: string) {
    setActionLoading(true)
    try {
      const res = await fetch(`/api/workflows/${taskId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionKey }),
      })
      const data = await res.json()
      if (!res.ok) { alert(`操作失败: ${data.error}`); return }
      setSelectedExec(data.execution)
      selectedExecRef.current = data.execution
      fetchExecutions()
    } catch {
      alert('网络错误')
    } finally {
      setActionLoading(false)
    }
  }

  const getExecutionsByWorkflow = (workflowId: string) =>
    executions
      .filter((e) => e.workflowId === workflowId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const waitingExecutions = executions.filter((e) => e.status === 'waiting')
  // AI: 新建工作流弹窗
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ─── 左侧：工作流列表 ─── */}
      <div className="w-72 flex-shrink-0 border-r border-border flex flex-col">
        <div
          style={{ height: 'var(--header-height)' }}
          className="flex items-center px-4 border-b border-border flex-shrink-0 gap-2"
        >
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-text-primary">工作流编排</h1>
            <p className="text-xs text-text-muted">
              {loading ? '加载中...' : `${workflows.length} 个工作流`}
            </p>
          </div>
          {/* AI: 新建工作流按钮 */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex-shrink-0 px-2 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors"
          >
            + 新建
          </button>
        </div>

        {/* AI: 新建工作流弹窗 */}
        {showCreate && (
          <CreateWorkflowModal
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); fetchWorkflows() }}
          />
        )}

        {waitingExecutions.length > 0 && (
          <div className="mx-3 mt-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-xs font-medium text-yellow-700">
              ⚠ {waitingExecutions.length} 个流程等待人工操作
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {loading ? (
            <div className="px-4 py-6 text-xs text-text-muted text-center">加载中...</div>
          ) : workflows.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-text-muted">暂无工作流</p>
              <p className="text-xs text-text-muted mt-1">在 workflows/*.yaml 中添加</p>
            </div>
          ) : (
            workflows.map((wf) => {
              const execs = getExecutionsByWorkflow(wf.id)
              const hasWaiting = execs.some((e) => e.status === 'waiting')
              const isSelected = selected?.id === wf.id
              return (
                <button
                  key={wf.id}
                  onClick={() => {
                    setSelected(wf)
                    selectExec(execs[0] ?? null)
                    exitEditMode()
                  }}
                  className={`w-full text-left px-4 py-3 border-b border-border-subtle transition-colors ${
                    isSelected ? 'bg-accent-subtle border-l-2 border-l-accent' : 'hover:bg-surface'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{wf.name}</p>
                      <p className="text-xs text-text-muted mt-0.5 font-mono">{wf.id}</p>
                      {wf.description && (
                        <p className="text-xs text-text-muted mt-1 line-clamp-2">{wf.description}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {hasWaiting && (
                        <span className="text-xs bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded-full">待操作</span>
                      )}
                      <span className="text-xs text-text-muted">{wf.steps.length} 步</span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ─── 中间：主内容区 ─── */}
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-4xl mb-4">⟳</p>
              <p className="text-sm text-text-secondary font-medium">选择一个工作流查看详情</p>
              <p className="text-xs text-text-muted mt-1">点击左侧工作流查看步骤定义和执行状态</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── 顶部工具栏 ── */}
            <div
              style={{ height: 'var(--header-height)' }}
              className="flex items-center px-6 border-b border-border flex-shrink-0 gap-3"
            >
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-text-primary truncate">
                  {editMode === 'visual' && draft ? draft.name : selected.name}
                </h2>
                <p className="text-xs text-text-muted font-mono">{selected.id}</p>
              </div>

              {/* AI: 编辑模式切换按钮组 */}
              {editMode === 'view' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => enterEditMode('visual')}
                    className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors flex items-center gap-1.5"
                  >
                    <span>✦</span> 可视化编辑
                  </button>
                  <button
                    onClick={() => enterEditMode('yaml')}
                    className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors"
                  >
                    ✎ 编辑 YAML
                  </button>
                </div>
              ) : editMode === 'visual' ? (
                <div className="flex gap-2 items-center">
                  {visualError && (
                    <span className="text-xs text-status-failed">{visualError}</span>
                  )}
                  <button
                    onClick={exitEditMode}
                    className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveDraft}
                    disabled={visualSaving}
                    className="text-xs px-3 py-1.5 bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {visualSaving ? '保存中...' : '✓ 保存'}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  {yamlError && (
                    <span className="text-xs text-status-failed">{yamlError}</span>
                  )}
                  <button
                    onClick={exitEditMode}
                    className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveYaml}
                    disabled={yamlSaving}
                    className="text-xs px-3 py-1.5 bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {yamlSaving ? '保存中...' : '✓ 保存'}
                  </button>
                </div>
              )}
            </div>

            {/* ── 内容区 ── */}
            <div className="flex-1 overflow-hidden">
              {editMode === 'visual' && draft ? (
                <VisualEditor
                  draft={draft}
                  onChange={setDraft}
                  agentOptions={agentOptions}
                />
              ) : editMode === 'yaml' ? (
                <div className="h-full flex flex-col p-6">
                  <p className="text-xs text-text-muted mb-2">修改 YAML 后点击保存立即生效</p>
                  <textarea
                    value={yamlContent}
                    onChange={(e) => setYamlContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 px-4 py-3 text-xs font-mono border border-border rounded-lg bg-surface text-text-primary resize-none focus:outline-none focus:border-accent"
                  />
                </div>
              ) : (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-lg mx-auto space-y-2">
                    {selected.steps.map((step, idx) => {
                      const log = selectedExec?.steps.find((s) => s.stepId === step.id)
                      const isCurrentStep = selectedExec?.currentStepId === step.id
                      const style = log ? STEP_STATUS_STYLE[log.status] : STEP_STATUS_STYLE.pending
                      return (
                        <div key={step.id}>
                          {idx > 0 && (
                            <div className="flex justify-center my-1">
                              <div className="w-px h-5 bg-border-subtle" />
                            </div>
                          )}
                          <ViewStepCard
                            step={step}
                            log={log}
                            style={style}
                            isCurrentStep={isCurrentStep}
                            onAction={
                              log?.status === 'waiting' && step.type === 'human_in_loop' && selectedExec
                                ? (ak) => handleHumanAction(selectedExec.taskId, ak)
                                : undefined
                            }
                            actionLoading={actionLoading}
                          />
                        </div>
                      )
                    })}
                    <div className="flex justify-center mt-2">
                      <div className="w-px h-5 bg-border-subtle" />
                    </div>
                    <div className="flex items-center justify-center gap-2 py-2">
                      <div
                        className={`w-3 h-3 rounded-full border-2 ${
                          selectedExec?.status === 'done'
                            ? 'bg-status-done border-status-done'
                            : 'bg-background border-border'
                        }`}
                      />
                      <span className="text-xs text-text-muted">
                        {selectedExec?.status === 'done' ? '流程完成' : '结束'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── 右侧：执行历史（仅 view 模式显示） ─── */}
      {selected && editMode === 'view' && (
        <div className="w-72 flex-shrink-0 border-l border-border flex flex-col">
          <div
            style={{ height: 'var(--header-height)' }}
            className="flex items-center px-4 border-b border-border flex-shrink-0"
          >
            <h3 className="text-sm font-semibold text-text-primary">执行记录</h3>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {getExecutionsByWorkflow(selected.id).length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-text-muted">暂无执行记录</p>
                <p className="text-xs text-text-muted mt-1">从看板创建工作流任务后将在这里显示</p>
              </div>
            ) : (
              getExecutionsByWorkflow(selected.id).map((exec) => (
                <ExecutionRecord
                  key={exec.taskId}
                  exec={exec}
                  selected={selectedExec?.taskId === exec.taskId}
                  onClick={() => selectExec(exec)}
                  onDeleted={() => {
                    if (selectedExec?.taskId === exec.taskId) selectExec(null)
                    fetchExecutions()
                  }}
                  stepStatusStyle={STEP_STATUS_STYLE}
                  execStatusBadge={EXEC_STATUS_BADGE}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* AI start: ExecutionRecord — 执行记录单条组件，支持显示任务标题和删除操作 */
function ExecutionRecord({
  exec,
  selected,
  onClick,
  onDeleted,
  stepStatusStyle,
  execStatusBadge,
}: {
  exec: WorkflowExecution
  selected: boolean
  onClick: () => void
  onDeleted: () => void
  stepStatusStyle: Record<StepStatus, { dot: string; text: string; label: string }>
  execStatusBadge: Record<WorkflowExecutionStatus, string>
}) {
  const [deleting, setDeleting] = useState(false)

  // AI: 删除执行记录（同时删除关联任务，若正在执行则强制停止 Agent）
  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    const isActive = exec.status === 'running' || exec.status === 'waiting'
    const msg = isActive
      ? `任务「${exec.taskTitle ?? exec.taskId}」正在执行，删除将强制停止 Agent。确认继续？`
      : `确认删除执行记录「${exec.taskTitle ?? exec.taskId}」？关联任务也将一并删除，此操作不可撤销。`
    if (!confirm(msg)) return
    setDeleting(true)
    try {
      await fetch(`/api/workflows/${exec.taskId}`, { method: 'DELETE' })
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`relative group border-b border-border-subtle ${selected ? 'bg-accent-subtle' : 'hover:bg-surface'}`}>
      <button
        onClick={onClick}
        className="w-full text-left px-4 py-3 transition-colors"
      >
        {/* AI: 任务标题（优先展示） */}
        {exec.taskTitle && (
          <p className="text-xs font-medium text-text-primary truncate mb-1">{exec.taskTitle}</p>
        )}
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${execStatusBadge[exec.status]}`}>
            {exec.status === 'running' ? '执行中' : exec.status === 'waiting' ? '待操作' : exec.status === 'done' ? '完成' : '失败'}
          </span>
          {exec.status === 'waiting' && (
            <span className="text-xs text-yellow-600 font-medium">⚠ 需操作</span>
          )}
        </div>
        <p className="text-xs font-mono text-text-muted truncate">{exec.taskId}</p>
        <p className="text-xs text-text-muted mt-1">
          {new Date(exec.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
        <div className="flex gap-1 mt-2 flex-wrap">
          {exec.steps.map((s) => {
            const st = stepStatusStyle[s.status]
            return (
              <div key={s.stepId} title={`${s.stepName}: ${st.label}`} className={`w-2 h-2 rounded-full ${st.dot}`} />
            )
          })}
        </div>
      </button>

      {/* AI: 删除按钮（hover 显示） */}
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="删除执行记录及关联任务"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-status-failed hover:bg-status-failed/5 disabled:opacity-40"
      >
        {deleting ? '…' : '✕'}
      </button>
    </div>
  )
}
/* AI end: ExecutionRecord 结束 */

// ─── 可视化编辑器主组件 ─────────────────────────────────────────────────────

/*  start: VisualEditor — 可视化工作流编辑器，支持步骤增删排序、字段内联编辑 */
function VisualEditor({
  draft,
  onChange,
  agentOptions,
}: {
  draft: DraftWorkflow
  onChange: (d: DraftWorkflow) => void
  agentOptions: string[]
}) {
  // AI: 当前展开编辑的步骤 ID
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)

  function updateMeta(patch: Partial<Pick<DraftWorkflow, 'name' | 'description'>>) {
    onChange({ ...draft, ...patch })
  }

  function updateStep(idx: number, patch: Partial<DraftStep>) {
    const steps = [...draft.steps]
    steps[idx] = { ...steps[idx], ...patch }
    onChange({ ...draft, steps })
  }

  function addStep() {
    const ids = draft.steps.map((s) => s.id)
    const step = newDraftStep(ids)
    onChange({ ...draft, steps: [...draft.steps, step] })
    setExpandedStepId(step.id)
  }

  function deleteStep(idx: number) {
    const steps = draft.steps.filter((_, i) => i !== idx)
    onChange({ ...draft, steps })
    setExpandedStepId(null)
  }

  function moveStep(idx: number, dir: -1 | 1) {
    const steps = [...draft.steps]
    const target = idx + dir
    if (target < 0 || target >= steps.length) return
    ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
    onChange({ ...draft, steps })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        {/* ── Meta 编辑区 ── */}
        <div className="border border-border rounded-xl p-4 bg-surface space-y-3">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider">工作流属性</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">名称 *</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => updateMeta({ name: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">ID（不可修改）</label>
              <input
                type="text"
                value={draft.id}
                readOnly
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-surface text-text-muted font-mono cursor-not-allowed"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">描述</label>
            <input
              type="text"
              value={draft.description}
              onChange={(e) => updateMeta({ description: e.target.value })}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* ── 步骤列表 ── */}
        <div className="space-y-1">
          {draft.steps.map((step, idx) => (
            <div key={step.id}>
              {/* AI: 步骤间连接线 */}
              {idx > 0 && (
                <div className="flex justify-center my-1">
                  <div className="w-px h-4 bg-border-subtle" />
                </div>
              )}
              <EditableStepCard
                step={step}
                idx={idx}
                total={draft.steps.length}
                allStepIds={draft.steps.map((s) => s.id)}
                isExpanded={expandedStepId === step.id}
                onToggle={() => setExpandedStepId(expandedStepId === step.id ? null : step.id)}
                onChange={(patch) => updateStep(idx, patch)}
                onDelete={() => deleteStep(idx)}
                onMoveUp={() => moveStep(idx, -1)}
                onMoveDown={() => moveStep(idx, 1)}
                agentOptions={agentOptions}
              />
            </div>
          ))}
        </div>

        {/* ── 添加步骤按钮 ── */}
        <div className="flex justify-center py-2">
          <button
            onClick={addStep}
            className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-border rounded-lg text-sm text-text-muted hover:border-accent hover:text-text-primary hover:bg-accent-subtle transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            <span>添加步骤</span>
          </button>
        </div>
      </div>
    </div>
  )
}
/*  end: VisualEditor */

// ─── 可编辑步骤卡片 ─────────────────────────────────────────────────────────

/*  start: EditableStepCard — 单步卡片，支持折叠/展开编辑所有字段 */
function EditableStepCard({
  step,
  idx,
  total,
  allStepIds,
  isExpanded,
  onToggle,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  agentOptions,
}: {
  step: DraftStep
  idx: number
  total: number
  allStepIds: string[]
  isExpanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<DraftStep>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  agentOptions: string[]
}) {
  const typeColor = STEP_TYPE_COLOR[step.type]
  const typeIconColor = STEP_TYPE_ICON_COLOR[step.type]

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${typeColor} ${isExpanded ? 'shadow-sm' : ''}`}>
      {/* ── 卡片头部（始终可见）── */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* AI: 步骤序号 */}
        <span className="w-5 h-5 flex-shrink-0 rounded-full bg-border/60 text-text-muted text-xs flex items-center justify-center font-mono font-medium">
          {idx + 1}
        </span>

        {/* AI: 类型图标 */}
        <span className={`text-base flex-shrink-0 ${typeIconColor}`}>
          {STEP_TYPE_ICON[step.type]}
        </span>

        {/* AI: 步骤名称（点击展开） */}
        <button
          onClick={onToggle}
          className="flex-1 text-left min-w-0"
        >
          <span className="text-sm font-medium text-text-primary truncate block">
            {step.name || <span className="text-text-muted italic">未命名步骤</span>}
          </span>
          <span className="text-xs text-text-muted font-mono">
            {step.id} · {STEP_TYPE_LABEL[step.type]}
            {step.agentName && step.type === 'agent' && ` · ${step.agentName}`}
          </span>
        </button>

        {/* AI: 控制按钮 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onMoveUp}
            disabled={idx === 0}
            title="上移"
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-25 transition-colors rounded"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={idx === total - 1}
            title="下移"
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary disabled:opacity-25 transition-colors rounded"
          >
            ↓
          </button>
          <button
            onClick={onToggle}
            title={isExpanded ? '收起' : '展开编辑'}
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors rounded"
          >
            {isExpanded ? '▲' : '▼'}
          </button>
          <button
            onClick={onDelete}
            title="删除步骤"
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-status-failed transition-colors rounded"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── 展开编辑区 ── */}
      {isExpanded && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3 bg-background/60 space-y-3">
          {/* 基础字段 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">步骤 ID *</label>
              <input
                type="text"
                value={step.id}
                onChange={(e) => onChange({ id: e.target.value.replace(/\s/g, '_') })}
                className="w-full px-2.5 py-1.5 text-xs font-mono border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">步骤名称 *</label>
              <input
                type="text"
                value={step.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1">步骤类型</label>
              <select
                value={step.type}
                onChange={(e) => {
                  const t = e.target.value as WorkflowStepType
                  // AI: 切换类型时清空不适用的字段
                  onChange({
                    type: t,
                    actions: t === 'human_in_loop' ? step.actions : [],
                    branches: t === 'parallel' ? step.branches : [],
                    agentName: t === 'parallel' || t === 'human_in_loop' ? '' : step.agentName,
                  })
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="agent">◉ Agent（执行代理）</option>
                <option value="human_in_loop">◈ Human（人工审批）</option>
                <option value="parallel">⊞ Parallel（并行执行）</option>
                <option value="conditional">◇ Conditional（条件分支）</option>
                <option value="loop">↺ Loop（循环）</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">下一步 ID（next）</label>
              <input
                type="text"
                value={step.next}
                onChange={(e) => onChange({ next: e.target.value })}
                placeholder="留空则顺序执行"
                className="w-full px-2.5 py-1.5 text-xs font-mono border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* AI: agent 类型专属字段 — 下拉筛选已加载的 agent */}
          {step.type === 'agent' && (
            <div>
              <label className="block text-xs text-text-muted mb-1">Agent 名称</label>
              {agentOptions.length > 0 ? (
                <select
                  value={step.agentName}
                  onChange={(e) => onChange({ agentName: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">-- 请选择 Agent --</option>
                  {agentOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={step.agentName}
                  onChange={(e) => onChange({ agentName: e.target.value })}
                  placeholder="如 architect / dev / qa / review"
                  className="w-full px-2.5 py-1.5 text-xs font-mono border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
                />
              )}
            </div>
          )}

          {/* AI: human_in_loop 专属：notify + actions */}
          {step.type === 'human_in_loop' && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`notify-${step.id}`}
                  checked={step.notify}
                  onChange={(e) => onChange({ notify: e.target.checked })}
                  className="rounded border-border"
                />
                <label htmlFor={`notify-${step.id}`} className="text-xs text-text-secondary">
                  发送 Mac 通知（notify: mac_notification）
                </label>
              </div>

              {/* actions 编辑 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-text-muted">操作映射（Actions）</label>
                  <button
                    onClick={() => onChange({ actions: [...step.actions, { key: '', target: '' }] })}
                    className="text-xs text-accent hover:text-accent-hover transition-colors"
                  >
                    + 添加操作
                  </button>
                </div>
                <div className="space-y-1.5">
                  {step.actions.map((action, ai) => (
                    <div key={ai} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={action.key}
                        onChange={(e) => {
                          const actions = [...step.actions]
                          actions[ai] = { ...actions[ai], key: e.target.value }
                          onChange({ actions })
                        }}
                        placeholder="操作名（如 approve）"
                        className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
                      />
                      <span className="text-text-muted text-xs">→</span>
                      <input
                        type="text"
                        value={action.target}
                        onChange={(e) => {
                          const actions = [...step.actions]
                          actions[ai] = { ...actions[ai], target: e.target.value }
                          onChange({ actions })
                        }}
                        placeholder="目标步骤 ID"
                        className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
                      />
                      <button
                        onClick={() => onChange({ actions: step.actions.filter((_, i) => i !== ai) })}
                        className="text-text-muted hover:text-status-failed transition-colors text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {step.actions.length === 0 && (
                    <p className="text-xs text-text-muted italic">暂无操作，点击上方添加</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* AI: parallel 专属：branches */}
          {step.type === 'parallel' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-text-muted">并行分支（Branches）</label>
                <button
                  onClick={() => onChange({ branches: [...step.branches, { name: '', agentName: '' }] })}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  + 添加分支
                </button>
              </div>
              <div className="space-y-1.5">
                {step.branches.map((branch, bi) => (
                  <div key={bi} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={branch.name}
                      onChange={(e) => {
                        const branches = [...step.branches]
                        branches[bi] = { ...branches[bi], name: e.target.value }
                        onChange({ branches })
                      }}
                      placeholder="分支名称"
                      className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
                    />
                    <span className="text-text-muted text-xs flex-shrink-0">agent:</span>
                    {/* AI: branch agentName 下拉选择 */}
                    {agentOptions.length > 0 ? (
                      <select
                        value={branch.agentName}
                        onChange={(e) => {
                          const branches = [...step.branches]
                          branches[bi] = { ...branches[bi], agentName: e.target.value }
                          onChange({ branches })
                        }}
                        className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-background text-text-primary focus:outline-none focus:border-accent"
                      >
                        <option value="">-- 选择 Agent --</option>
                        {agentOptions.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={branch.agentName}
                        onChange={(e) => {
                          const branches = [...step.branches]
                          branches[bi] = { ...branches[bi], agentName: e.target.value }
                          onChange({ branches })
                        }}
                        placeholder="如 qa / review"
                        className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-background text-text-primary focus:outline-none focus:border-accent placeholder:text-text-muted"
                      />
                    )}
                    <button
                      onClick={() => onChange({ branches: step.branches.filter((_, i) => i !== bi) })}
                      className="text-text-muted hover:text-status-failed transition-colors text-xs"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {step.branches.length === 0 && (
                  <p className="text-xs text-text-muted italic">暂无分支，点击上方添加</p>
                )}
              </div>
              <p className="text-xs text-text-muted mt-2">
                ↳ 所有分支完成后，流程跳转到「下一步 ID」字段中指定的步骤
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
/*  end: EditableStepCard */

// ─── 只读步骤卡片（view 模式）─────────────────────────────────────────────────

function ViewStepCard({
  step,
  log,
  style,
  isCurrentStep,
  onAction,
  actionLoading,
}: {
  step: WorkflowStep
  log?: StepLog
  style: { dot: string; text: string; label: string }
  isCurrentStep: boolean
  onAction?: (actionKey: string) => void
  actionLoading: boolean
}) {
  return (
    <div
      className={`border rounded-lg p-4 transition-all ${
        isCurrentStep
          ? 'border-accent shadow-sm shadow-accent/20'
          : log?.status === 'done'
          ? 'border-border-subtle opacity-80'
          : log?.status === 'failed'
          ? 'border-status-failed/50 bg-red-50'
          : 'border-border'
      } bg-background`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className="text-base text-text-muted">{STEP_TYPE_ICON[step.type]}</span>
          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{step.name}</span>
            <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
          </div>
          {step.agentName && (
            <p className="text-xs text-text-muted font-mono mt-0.5">{step.agentName}</p>
          )}
          <p className="text-xs text-text-muted font-mono mt-0.5 opacity-60">id: {step.id}</p>
          {log?.startedAt && (
            <p className="text-xs text-text-muted mt-1">
              耗时: {fmtDuration(log.startedAt, log.completedAt)}
            </p>
          )}
          {log?.error && (
            <p className="text-xs text-status-failed mt-1 break-all">{log.error}</p>
          )}
        </div>
      </div>

      {step.type === 'parallel' && step.branches && step.branches.length > 0 && (
        <div className="mt-3 ml-8 flex gap-2 flex-wrap">
          {step.branches.map((branch) => (
            <div key={branch.id} className="flex items-center gap-1.5 px-2 py-1 bg-surface border border-border-subtle rounded text-xs">
              <span className="text-text-muted">{STEP_TYPE_ICON.agent}</span>
              <span className="text-text-secondary">{branch.name}</span>
              {branch.agentName && <span className="text-text-muted font-mono">({branch.agentName})</span>}
            </div>
          ))}
        </div>
      )}

      {step.type === 'human_in_loop' && log?.status === 'waiting' && step.actions && onAction && (
        <div className="mt-3 ml-8 flex gap-2 flex-wrap">
          {Object.entries(step.actions).map(([key, targetStep]) => (
            <button
              key={key}
              onClick={() => onAction(key)}
              disabled={actionLoading}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                key === 'approve'
                  ? 'bg-accent text-text-inverse hover:bg-accent-hover'
                  : key === 'reject'
                  ? 'bg-status-failed/10 text-status-failed border border-status-failed/30 hover:bg-status-failed/20'
                  : 'bg-surface text-text-secondary border border-border hover:bg-accent-subtle'
              } disabled:opacity-50`}
            >
              {actionLoading ? '处理中...' : key === 'approve' ? '✓ 批准' : key === 'reject' ? '✗ 拒绝' : key}
              <span className="ml-1 text-xs opacity-60 font-mono">→ {targetStep}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
// ─── 新建工作流弹窗 ──────────────────────────────────────────────────────────
/* AI start: CreateWorkflowModal — 填写 ID、名称、描述，生成初始 YAML 并调 POST /api/workflows/def */
function CreateWorkflowModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({ id: '', name: '', description: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    if (!form.id.trim()) { setError('工作流 ID 不能为空'); return }
    if (!/^[a-zA-Z0-9_-]+$/.test(form.id.trim())) {
      setError('ID 只能包含字母、数字、连字符(-)和下划线(_)')
      return
    }
    if (!form.name.trim()) { setError('名称不能为空'); return }
    setLoading(true)
    setError('')
    // AI: 生成初始 YAML 内容
    const initialYaml = [
      `name: ${form.name.trim()}`,
      `id: ${form.id.trim()}`,
      form.description.trim() ? `description: '${form.description.trim()}'` : `description: ''`,
      '',
      'steps:',
      '  - id: step1',
      `    name: 第一步`,
      `    agent: my-agent`,
    ].join('\n')
    try {
      const res = await fetch('/api/workflows/def', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: form.id.trim(), yaml: initialYaml }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '创建失败'); return }
      onCreated()
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-xl p-5 w-full max-w-md shadow-2xl">
        <h2 className="text-sm font-semibold text-text-primary mb-4">新建工作流</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">工作流 ID *</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value.replace(/\s/g, '-') })}
              placeholder="my-workflow"
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            <p className="text-[10px] text-text-muted mt-0.5">对应 workflows/&lt;id&gt;.yaml 文件名，创建后不可修改</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="我的工作流"
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">描述（可选）</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="工作流用途说明..."
              className="w-full px-2 py-1.5 text-xs border border-border rounded bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>
        {error && <p className="text-xs text-status-failed mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {loading ? '创建中...' : '创建工作流'}
          </button>
        </div>
      </div>
    </div>
  )
}
/* AI end: CreateWorkflowModal 结束 */

/*  end: 工作流编排页结束 */
