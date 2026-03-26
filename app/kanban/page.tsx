'use client'
import { useEffect, useState } from 'react'
import { useTasksStore } from '@/store/tasksStore'
import type { Task, TaskStatus, WorkflowConfig, AgentStats } from '@/lib/types'
import type { OcAgentInfo } from '@/lib/openclawIntegration'
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from '@/lib/types'
import { Plus, RefreshCw, ChevronRight } from 'lucide-react'

/* AI start: 任务看板页面 — 按状态列展示任务，支持通用任务与自定义工作流 */

// AI: 通用看板列，不再包含前端专属状态
const COLUMNS: TaskStatus[] = ['Inbox', 'InProgress', 'Done', 'Blocked']

const COL_COLORS: Record<TaskStatus, string> = {
  Inbox: '#4a5568',
  InProgress: '#2b6cb0',
  Done: '#276749',
  Blocked: '#9b2c2c',
  Cancelled: '#2d3748',
}

/*  start: 创建任务弹窗，工作流从 API 动态加载，默认无工作流 */
function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { createTask } = useTasksStore()
  const [form, setForm] = useState({
    title: '',
    description: '',
    workflowId: '',         // AI: 默认空字符串 = 无工作流
    assignedAgent: '',      // AI: 默认空字符串 = openclaw 默认代理
    requirementDoc: '',
    backendDesign: '',
    repos: '',
  })
  const [loading, setLoading] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([])
  const [armAgents, setArmAgents] = useState<AgentStats[]>([])
  const [ocAgents, setOcAgents] = useState<OcAgentInfo[]>([])

  /* AI start: 挂载时并行加载工作流、ARM agents、OpenClaw agents */
  useEffect(() => {
    Promise.all([
      fetch('/api/workflows').then(r => r.json()).catch(() => []),
      fetch('/api/agents').then(r => r.json()).catch(() => []),
      fetch('/api/openclaw/agents').then(r => r.json()).catch(() => []),
    ]).then(([wfs, arms, ocs]) => {
      setWorkflows(wfs)
      setArmAgents(arms)
      // AI: 过滤掉已在 ARM agents 中的，避免重复（ARM agent 在 OpenClaw 注册为 arm-{id}）
      const armIds = new Set((arms as AgentStats[]).map(a => `arm-${a.agentId}`))
      setOcAgents((ocs as OcAgentInfo[]).filter(a => !armIds.has(a.id)))
    })
  }, [])
  /* AI end: 并行加载 */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await createTask({
        ...form,
        workflowId: form.workflowId || undefined,        // AI: 空字符串转 undefined，不传工作流
        assignedAgent: form.assignedAgent || undefined,  // AI: 空字符串转 undefined，使用默认 openclaw
        repos: form.repos ? form.repos.split('\n').map(s => s.trim()).filter(Boolean) : [],
      })
      onCreated()
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg rounded-xl p-6" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
        <h2 className="text-lg font-bold text-white mb-4">📋 创建新任务</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>任务标题 *</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="例：优化用户登录流程"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>任务描述</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            />
          </div>
          {/* AI: 工作流选择 — 动态从 API 加载，默认「无工作流」 */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>
              工作流
              <span className="ml-1" style={{ color: '#4a5568' }}>（可选，不绑定则为普通任务）</span>
            </label>
            <select
              value={form.workflowId}
              onChange={e => setForm(f => ({ ...f, workflowId: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            >
              <option value="">— 无工作流（普通任务）—</option>
              {workflows.map(wf => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          </div>
          {/* AI: 执行 Agent 选择 — 合并 ARM agents + OpenClaw agents，分组展示 */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>
              执行 Agent
              <span className="ml-1" style={{ color: '#4a5568' }}>（可选，不指定则使用 openclaw 默认代理）</span>
            </label>
            <select
              value={form.assignedAgent}
              onChange={e => setForm(f => ({ ...f, assignedAgent: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            >
              <option value="">— openclaw 默认代理 —</option>
              {/* AI: ARM 内部 Agents 分组 */}
              {armAgents.length > 0 && (
                <optgroup label="ARM Agents">
                  {armAgents.map(ag => (
                    <option key={ag.agentId} value={ag.agentId}>
                      {ag.displayName}（{ag.agentId}）
                    </option>
                  ))}
                </optgroup>
              )}
              {/* AI: OpenClaw 其他 Agents 分组 */}
              {ocAgents.length > 0 && (
                <optgroup label="OpenClaw Agents">
                  {ocAgents.map(ag => (
                    <option key={ag.id} value={ag.id}>
                      {ag.id}{ag.workspaceExists ? '' : '（未初始化）'}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>需求文档路径</label>
            <input
              value={form.requirementDoc}
              onChange={e => setForm(f => ({ ...f, requirementDoc: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="/path/to/requirement.md"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>技术方案路径</label>
            <input
              value={form.backendDesign}
              onChange={e => setForm(f => ({ ...f, backendDesign: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="/path/to/design.md"
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>关联仓库（每行一个）</label>
            <textarea
              value={form.repos}
              onChange={e => setForm(f => ({ ...f, repos: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              placeholder="https://github.com/org/repo-a&#10;https://github.com/org/repo-b"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm"
              style={{ background: '#2d3148', color: '#a0aec0' }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: '#3b82f6' }}
            >
              {loading ? '创建中...' : '创建任务'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
/*  end: 创建任务弹窗 */

// AI: 任务卡片 — 已删除任务用遞色+删除线标示，工作流任务显示细粒度步骤状态
function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const isDeleted = !!task.deletedAt
  const hasWorkflow = !!task.workflowId && !!task.stepLogs && task.stepLogs.length > 0

  // AI: 找到当前正在运行的步骤（用于显示细粒度状态）
  const currentStep = hasWorkflow
    ? task.stepLogs!.find(s => s.status === 'running')
    : null

  // AI: 计算步骤进度（已完成/总数）
  const stepProgress = hasWorkflow
    ? `${task.stepLogs!.filter(s => s.status === 'done').length + 1}/${task.stepLogs!.length}`
    : null

  return (
    <div
      onClick={onClick}
      className="p-2.5 rounded-lg cursor-pointer transition-colors hover:border-blue-500"
      style={isDeleted
        ? { background: '#16181f', border: '1px solid #3d1f1f', opacity: 0.65 }
        : { background: '#1e2130', border: '1px solid #2d3148' }}
    >
      {/* AI: 标题行 — 更紧凑 */}
      <div
        className="text-xs font-medium leading-snug mb-1 line-clamp-2"
        style={isDeleted ? { color: '#6b7280', textDecoration: 'line-through' } : { color: '#fff' }}
      >
        {isDeleted && <span className="mr-1" style={{ color: '#ef4444' }}>🗑</span>}
        {task.title}
      </div>

      {/* AI: 描述 — 字体更小 */}
      {task.description && (
        <div className="text-[11px] mb-1.5 line-clamp-2" style={{ color: '#6b7280' }}>{task.description}</div>
      )}

      {/* AI: 工作流任务 — 显示当前步骤 + 主导 agent + 进度 */}
      {hasWorkflow && currentStep && (
        <div className="mb-1.5 space-y-1">
          {/* AI: 当前步骤名称 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#1e2d4a', color: '#60a5fa' }}>
              {currentStep.stepName}
            </span>
            {stepProgress && (
              <span className="text-[10px] font-mono" style={{ color: '#4a5568' }}>{stepProgress}</span>
            )}
          </div>
          {/* AI: 主导 agent 标签 */}
          {currentStep.agentId && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={(() => {
                const c = agentColor(currentStep.agentId!)
                return { background: c.bg, color: c.color, border: `1px solid ${c.border}` }
              })()}
            >
              {currentStep.agentId === 'you' ? '👤 你' : `🤖 ${currentStep.agentId}`}
            </span>
          )}
        </div>
      )}

      {/* AI: 底部状态行 */}
      <div className="flex items-center justify-between">
        {!hasWorkflow ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: '#0f1117', color: '#4a5568' }}>
            普通任务
          </span>
        ) : !currentStep ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: '#0f1117', color: '#8892a4' }}>
            {task.workflowId}
          </span>
        ) : null}
        <span className="text-[11px]" style={{ color: '#4a5568' }}>
          {new Date(task.updatedAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
    </div>
  )
}

/* AI start: 工具函数 — agent 角色颜色映射 */
function agentColor(agent: string): { bg: string; color: string; border: string } {
  if (agent.includes('architect')) return { bg: '#1e2d4a', color: '#93c5fd', border: '#1e3a5f' }
  if (agent.includes('dev'))       return { bg: '#1a2e1a', color: '#86efac', border: '#166534' }
  if (agent.includes('qa'))        return { bg: '#2d1f3d', color: '#c4b5fd', border: '#5b21b6' }
  if (agent.includes('review'))    return { bg: '#2d2010', color: '#fcd34d', border: '#92400e' }
  if (agent === 'you')             return { bg: '#1e2a2a', color: '#34d399', border: '#065f46' }
  return { bg: '#1e2130', color: '#94a3b8', border: '#2d3148' }
}

// AI: 状态颜色映射（inline style 版本）
const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Inbox:      { bg: '#252a3a', color: '#94a3b8' },
  InProgress: { bg: '#1e2d4a', color: '#60a5fa' },
  Done:       { bg: '#1a2e1a', color: '#4ade80' },
  Blocked:    { bg: '#2d1a1a', color: '#f87171' },
  Cancelled:  { bg: '#1f1f1f', color: '#6b7280' },
}

// AI: 文档链接组件 — 路径可点击打开新窗口，hover 显示复制按钮
function DocLink({ label, path: docPath, icon, isRepo }: { label: string; path?: string; icon: string; isRepo?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [hovering, setHovering] = useState(false)
  
  if (!docPath) return null
  
  // AI: 判断是否为 URL（http/https 开头）或本地路径
  const isUrl = docPath.startsWith('http://') || docPath.startsWith('https://')
  const href = isUrl ? docPath : (isRepo ? undefined : `file://${docPath}`)
  
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(docPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  
  const handleClick = (e: React.MouseEvent) => {
    if (isRepo) {
      e.preventDefault()
      navigator.clipboard.writeText(docPath)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="flex items-center gap-2 px-3 py-2 rounded-lg group transition-all relative"
      style={{ 
        background: '#0f1117', 
        border: `1px solid ${hovering ? '#3b82f6' : '#2d3148'}`, 
        textDecoration: 'none',
        cursor: isRepo ? 'pointer' : 'default'
      }}
    >
      <span className="text-base">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium" style={{ color: '#94a3b8' }}>
          {label}
          {isRepo && <span className="ml-1.5 text-[10px]" style={{ color: '#4a5568' }}>(点击复制，Finder 打开)</span>}
        </div>
        <div className="text-xs truncate group-hover:underline" style={{ color: '#60a5fa' }}>{docPath}</div>
      </div>
      
      {/* AI: Hover 复制按钮 */}
      {hovering && (
        <button
          onClick={handleCopy}
          className="flex-shrink-0 px-2 py-1 rounded text-xs font-medium transition-colors"
          style={{ 
            background: copied ? '#1a2e2e' : '#1e2d4a', 
            color: copied ? '#34d399' : '#60a5fa',
            border: `1px solid ${copied ? '#065f46' : '#2563eb'}`
          }}
        >
          {copied ? '✓ 已复制' : '📋 复制'}
        </button>
      )}
      
      {!hovering && !isRepo && (
        <span className="text-xs flex-shrink-0" style={{ color: '#4a5568' }}>↗</span>
      )}
    </a>
  )
}
/* AI end: 工具函数 */

/*  start: 任务详情弹窗 — 重设计版，宽敞布局 + 文档链接 + 彩色历史时间线 */
function TaskDetailModal({ task, onClose, onRefresh }: { task: Task; onClose: () => void; onRefresh: () => void }) {
  const { updateStatus, softDeleteTask, restoreTask } = useTasksStore()
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const isDeleted = !!task.deletedAt

  const handleStatusChange = async (newStatus: TaskStatus) => {
    setLoading(true)
    try {
      await updateStatus(task.id, newStatus, 'you', note || undefined)
      onRefresh()
      onClose()
    } catch (e: unknown) {
      alert((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // AI: 检查是否有任何文档
  const hasDocs = task.requirementDoc || task.backendDesign || task.frontendDesign || task.qaReport || task.reviewReport

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* AI: 弹窗主体 — 最大宽度加大，最大高度限制并内部滚动 */}
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col"
        style={{
          background: '#161b27',
          border: '1px solid #2d3148',
          maxHeight: 'calc(100vh - 2rem)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
        }}
      >
        {/* AI: 顶部标题区 */}
        <div className="px-6 pt-6 pb-4" style={{ borderBottom: '1px solid #2d3148' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white leading-snug mb-3">{task.title}</h2>
              {/* AI: 状态 + 工作流 + Agent 标签行 */}
              <div className="flex items-center flex-wrap gap-2">
                {/* AI: 状态徽标 */}
                <span
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={STATUS_STYLE[task.status] ?? STATUS_STYLE.Inbox}
                >
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'currentColor' }} />
                  {TASK_STATUS_LABELS[task.status]}
                </span>
                {/* AI: 工作流徽标 */}
                {task.workflowId && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: '#1e2540', color: '#818cf8', border: '1px solid #312e81' }}>
                    ⚙ {task.workflowId}
                  </span>
                )}
                {/* AI: 当前工作流步骤 */}
                {task.workflowStep && (
                  <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: '#1a2e2e', color: '#34d399', border: '1px solid #065f46' }}>
                    → {task.workflowStep}
                  </span>
                )}
                {/* AI: 执行 Agent 彩色徽标 */}
                {(() => {
                  const agent = task.assignedAgent ?? 'openclaw'
                  const c = agentColor(agent)
                  return (
                    <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                      🤖 {agent === 'openclaw' ? 'openclaw 默认' : agent}
                    </span>
                  )
                })()}
                {/* AI: 评分 */}
                {task.score !== undefined && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-bold" style={{ background: '#2d2010', color: '#fbbf24', border: '1px solid #92400e' }}>
                    ★ {task.score}
                  </span>
                )}
              </div>
            </div>
            {/* AI: 关闭按钮 */}
            <button
              onClick={onClose}
              className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: '#6b7280', background: '#1e2130' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2d3148'; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#1e2130'; e.currentTarget.style.color = '#6b7280' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* AI: 已删除任务的提示横幅 */}
          {isDeleted && (
            <div
              className="mx-6 mt-4 px-4 py-3 rounded-xl flex items-center justify-between gap-3"
              style={{ background: '#2d1a1a', border: '1px solid #7f1d1d' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">🗑️</span>
                <div>
                  <div className="text-xs font-semibold" style={{ color: '#f87171' }}>此任务已删除</div>
                  <div className="text-xs" style={{ color: '#6b7280' }}>
                    删除于 {new Date(task.deletedAt!).toLocaleString('zh-CN')}
                  </div>
                </div>
              </div>
              <button
                onClick={async () => {
                  setLoading(true)
                  try { await restoreTask(task.id); onRefresh(); onClose() }
                  finally { setLoading(false) }
                }}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-50"
                style={{ background: '#1a2e2e', color: '#34d399', border: '1px solid #065f46' }}
              >
                ↩ 恢复任务
              </button>
            </div>
          )}

        {/* AI: 可滚动内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* AI start: 工作流步骤进度轨道 — 有 stepLogs 时展示 */}
          {task.stepLogs && task.stepLogs.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: '#4a5568' }}>
                <span>⚡ 工作流进度</span>
                {task.workflowId && (
                  <span className="text-xs normal-case font-normal px-2 py-0.5 rounded-full" style={{ background: '#1e2540', color: '#818cf8', border: '1px solid #312e81' }}>
                    {task.workflowId}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {task.stepLogs.map((log, i) => {
                  // AI: 步骤状态对应的配色方案
                  const styleMap: Record<string, { dot: string; bg: string; border: string; label: string; icon: string }> = {
                    pending:  { dot: '#4a5568', bg: '#1a1d2b', border: '#2d3148', label: '#6b7280', icon: '○' },
                    running:  { dot: '#3b82f6', bg: '#1e2d4a', border: '#2563eb', label: '#93c5fd', icon: '◉' },
                    done:     { dot: '#22c55e', bg: '#1a2e1a', border: '#16a34a', label: '#4ade80', icon: '✓' },
                    rejected: { dot: '#ef4444', bg: '#2d1a1a', border: '#dc2626', label: '#f87171', icon: '✕' },
                    skipped:  { dot: '#6b7280', bg: '#1e1e26', border: '#374151', label: '#6b7280', icon: '—' },
                  }
                  const s = styleMap[log.status] ?? styleMap.pending
                  const isRunning = log.status === 'running'

                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all"
                      style={{ background: s.bg, border: `1px solid ${s.border}` }}
                    >
                      {/* AI: 步骤状态点 */}
                      <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
                        style={{ background: s.dot + '33', color: s.dot, border: `1.5px solid ${s.dot}` }}
                      >
                        {isRunning ? (
                          <span className="animate-pulse">{s.icon}</span>
                        ) : s.icon}
                      </div>

                      {/* AI: 步骤信息主体 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold" style={{ color: s.label }}>
                            {log.stepName}
                          </span>
                          {/* AI: 状态标签 */}
                          <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: s.dot + '22', color: s.dot }}>
                            {log.status === 'pending' ? '等待中' :
                             log.status === 'running' ? '执行中' :
                             log.status === 'done' ? '已完成' :
                             log.status === 'rejected' ? '已退回' : '已跳过'}
                          </span>
                          {/* AI: 执行 agent 标签 */}
                          {log.agentId && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full" style={(() => {
                              const c = agentColor(log.agentId)
                              return { background: c.bg, color: c.color, border: `1px solid ${c.border}` }
                            })()}>
                              {log.agentId === 'you' ? '👤 你' : `🤖 ${log.agentId}`}
                            </span>
                          )}
                        </div>

                        {/* AI: 时间信息 */}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {log.startedAt && (
                            <span className="text-xs" style={{ color: '#4a5568' }}>
                              开始: {new Date(log.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {log.completedAt && (
                            <span className="text-xs" style={{ color: '#4a5568' }}>
                              完成: {new Date(log.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {/* AI: 耗时计算 */}
                          {log.startedAt && log.completedAt && (
                            <span className="text-xs font-mono" style={{ color: '#4a5568' }}>
                              ⏱ {Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000 / 60)}min
                            </span>
                          )}
                        </div>

                        {/* AI: 产出备注 */}
                        {log.outputNote && (
                          <div className="mt-1.5 text-xs px-2 py-1 rounded-lg leading-relaxed truncate" style={{ background: '#0f1117', color: '#64748b' }}>
                            {log.outputNote}
                          </div>
                        )}

                        {/* AI: 错误/退回原因 */}
                        {log.error && (
                          <div className="mt-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: '#2d1a1a', color: '#f87171', border: '1px solid #7f1d1d' }}>
                            ⚠ {log.error}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {/* AI end: 工作流步骤进度轨道 */}

          {/* AI: 任务描述 */}
          {task.description && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: '#4a5568' }}>描述</div>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>{task.description}</p>
            </div>
          )}

          {/* AI: 时间信息 */}
          <div className="flex gap-6">
            <div>
              <div className="text-xs mb-1" style={{ color: '#4a5568' }}>创建时间</div>
              <div className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                {new Date(task.createdAt).toLocaleString('zh-CN')}
              </div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: '#4a5568' }}>最后更新</div>
              <div className="text-sm font-medium" style={{ color: '#94a3b8' }}>
                {new Date(task.updatedAt).toLocaleString('zh-CN')}
              </div>
            </div>
          </div>

          {/* AI: 文档链接区 — 有文档时展示 */}
          {hasDocs && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>关联文档</div>
              <div className="grid grid-cols-1 gap-2">
                <DocLink label="需求文档" path={task.requirementDoc} icon="📄" />
                <DocLink label="后端技术方案" path={task.backendDesign} icon="🔧" />
                <DocLink label="前端技术方案" path={task.frontendDesign} icon="🎨" />
                <DocLink label="QA 测试报告" path={task.qaReport} icon="🧪" />
                <DocLink label="代码审查报告" path={task.reviewReport} icon="🔍" />
              </div>
            </div>
          )}

          {/* AI: 关联仓库 */}
          {task.repos && task.repos.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>关联仓库</div>
              <div className="flex flex-wrap gap-2">
                {task.repos.map((repo, i) => (
                  <a
                    key={i}
                    href={repo}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                    style={{ background: '#0f1117', color: '#60a5fa', border: '1px solid #2d3148', textDecoration: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#2d3148')}
                  >
                    <span>⎇</span>{repo.replace(/^https?:\/\//, '')}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* AI: 流转历史时间线 */}
          {task.history.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>
                流转历史 <span className="normal-case ml-1" style={{ color: '#2d3148' }}>({task.history.length} 条)</span>
              </div>
              <div className="relative">
                {/* AI: 竖线轨道 */}
                <div className="absolute left-3.5 top-0 bottom-0 w-px" style={{ background: '#2d3148' }} />
                <div className="space-y-4">
                  {task.history.map((h, i) => {
                    const fromStyle = STATUS_STYLE[h.from] ?? STATUS_STYLE.Inbox
                    const toStyle   = STATUS_STYLE[h.to]   ?? STATUS_STYLE.Inbox
                    const ac = agentColor(h.agent)
                    return (
                      <div key={i} className="flex gap-4 relative">
                        {/* AI: 时间线圆点 */}
                        <div
                          className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold z-10"
                          style={{ background: toStyle.bg, color: toStyle.color, border: `2px solid ${toStyle.color}` }}
                        >
                          {i + 1}
                        </div>
                        {/* AI: 历史条目内容卡片 */}
                        <div
                          className="flex-1 rounded-xl p-4 min-w-0"
                          style={{ background: '#1e2130', border: '1px solid #2d3148' }}
                        >
                          {/* AI: 状态流转行 */}
                          <div className="flex items-center flex-wrap gap-2 mb-2">
                            <span className="text-xs px-2 py-0.5 rounded-md font-medium" style={fromStyle}>
                              {TASK_STATUS_LABELS[h.from] ?? h.from}
                            </span>
                            <ChevronRight size={12} style={{ color: '#4a5568', flexShrink: 0 }} />
                            <span className="text-xs px-2 py-0.5 rounded-md font-semibold" style={toStyle}>
                              {TASK_STATUS_LABELS[h.to] ?? h.to}
                            </span>
                          </div>
                          {/* AI: 执行者 + 时间 */}
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium inline-flex items-center gap-1"
                              style={{ background: ac.bg, color: ac.color, border: `1px solid ${ac.border}` }}
                            >
                              🤖 {h.agent}
                            </span>
                            <span className="text-xs" style={{ color: '#4a5568' }}>
                              {new Date(h.timestamp).toLocaleString('zh-CN')}
                            </span>
                          </div>
                          {/* AI: 备注独立行 */}
                          {h.note && (
                            <div
                              className="mt-2 text-xs px-3 py-1.5 rounded-lg leading-relaxed"
                              style={{ background: '#0f1117', color: '#94a3b8', borderLeft: '3px solid #3b82f6' }}
                            >
                              {h.note}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI: 底部操作区 — 固定在底部（已删除任务只显示恢复+关闭） */}
        {isDeleted ? (
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid #2d3148' }}>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ background: '#1e2130', color: '#94a3b8', border: '1px solid #2d3148' }}
            >
              关闭
            </button>
          </div>
        ) : (
          <>{/* AI: 底部操作区 — 固定在底部 */}
        {task.status !== 'Done' && task.status !== 'Cancelled' && (
          <div className="px-6 py-4" style={{ borderTop: '1px solid #2d3148' }}>
            <div className="mb-3">
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="添加备注（可选）"
                className="w-full px-4 py-2.5 rounded-xl text-sm text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#3b82f6')}
                onBlur={e => (e.currentTarget.style.borderColor = '#2d3148')}
              />
            </div>

            {/* AI start: 工作流审批按钮 — 当任务处于 pending_approval 步骤时显示 */}
            {task.workflowStep === 'pending_approval' && (
              <div className="mb-3 rounded-xl p-3" style={{ background: '#1a2744', border: '1px solid #2a4a8a' }}>
                <div className="text-xs font-semibold mb-2" style={{ color: '#93c5fd' }}>
                  📋 待审批：前端技术方案
                </div>
                {task.frontendDesign && (
                  <div className="text-xs mb-3 px-2 py-1.5 rounded-lg" style={{ background: '#0f1117', color: '#60a5fa' }}>
                    📄 {task.frontendDesign}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      setLoading(true)
                      try {
                        await fetch(`/api/tasks/${task.id}/approve`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'approve', note: note || '审批通过，开始开发' }),
                        })
                        onRefresh()
                        onClose()
                      } finally { setLoading(false) }
                    }}
                    disabled={loading}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #15803d, #22c55e)' }}
                  >
                    ✅ 审批通过
                  </button>
                  <button
                    onClick={async () => {
                      setLoading(true)
                      try {
                        await fetch(`/api/tasks/${task.id}/approve`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'reject', note: note || '退回重做' }),
                        })
                        onRefresh()
                        onClose()
                      } finally { setLoading(false) }
                    }}
                    disabled={loading}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                    style={{ background: '#7f1d1d', color: '#fca5a5', border: '1px solid #991b1b' }}
                  >
                    ↩ 退回重做
                  </button>
                </div>
              </div>
            )}
            {/* AI end: 工作流审批按钮 */}

            {/* AI start: 工作流打分按钮 — 当任务处于 pending_score 步骤时显示 */}
            {task.workflowStep === 'pending_score' && (
              <div className="mb-3 rounded-xl p-3" style={{ background: '#1a2a1a', border: '1px solid #2a5a2a' }}>
                <div className="text-xs font-semibold mb-2" style={{ color: '#86efac' }}>
                  🏆 待打分：QA + Code Review 已完成
                </div>
                <div className="flex gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button
                      key={s}
                      onClick={async () => {
                        setLoading(true)
                        try {
                          await fetch(`/api/tasks/${task.id}/approve`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'score', note: `打分: ${s}/5`, score: s }),
                          })
                          onRefresh()
                          onClose()
                        } finally { setLoading(false) }
                      }}
                      disabled={loading}
                      className="flex-1 py-2 rounded-lg text-sm font-bold transition-opacity disabled:opacity-50"
                      style={{ background: '#14532d', color: '#86efac', border: '1px solid #16a34a' }}
                    >
                      {s}⭐
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* AI end: 打分按钮 */}

            <div className="flex flex-wrap gap-2">
              {task.status === 'Inbox' && (
                <button
                  onClick={() => handleStatusChange('InProgress')}
                  disabled={loading}
                  className="flex-1 min-w-[120px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6)' }}
                >
                  ▶ 开始执行
                </button>
              )}
              {/* AI: 只有在非工作流审批步骤时才显示「标记完成」按钮 */}
              {task.status === 'InProgress' && task.workflowStep !== 'pending_approval' && task.workflowStep !== 'pending_score' && (
                <button
                  onClick={() => handleStatusChange('Done')}
                  disabled={loading}
                  className="flex-1 min-w-[120px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #15803d, #22c55e)' }}
                >
                  ✓ 标记完成
                </button>
              )}
              {task.status === 'Blocked' && (
                <button
                  onClick={() => handleStatusChange('InProgress')}
                  disabled={loading}
                  className="flex-1 min-w-[120px] px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #3b82f6)' }}
                >
                  ↩ 解除阻塞
                </button>
              )}
              {(task.status === 'Inbox' || task.status === 'InProgress') && (
                <button
                  onClick={() => handleStatusChange('Blocked')}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: '#7f1d1d', border: '1px solid #991b1b' }}
                >
                  ⊘ 标记阻塞
                </button>
              )}
              <button
                onClick={() => handleStatusChange('Cancelled')}
                disabled={loading}
                className="px-4 py-2.5 rounded-xl text-sm transition-opacity disabled:opacity-50"
                style={{ background: '#1e2130', color: '#6b7280', border: '1px solid #2d3148' }}
              >
                取消任务
              </button>
            </div>
          </div>
        )}
        {/* AI: 已完成 / 已取消 任务的只读底栏 */}
        {(task.status === 'Done' || task.status === 'Cancelled') && (
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderTop: '1px solid #2d3148' }}>
            <span className="text-sm" style={{ color: '#4a5568' }}>
              {task.status === 'Done' ? '✓ 任务已完成' : '✕ 任务已取消'}
            </span>
            <div className="flex items-center gap-2">
              {/* AI: 软删除按钮 — 在已完成/取消任务的底栏也提供删除入口 */}
              <button
                onClick={async () => {
                  if (!confirm('确认删除此任务？可在「已删除」开关中找回。')) return
                  setLoading(true)
                  try { await softDeleteTask(task.id); onRefresh(); onClose() }
                  finally { setLoading(false) }
                }}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-xs transition-opacity disabled:opacity-50"
                style={{ background: '#2d1a1a', color: '#f87171', border: '1px solid #7f1d1d' }}
              >
                🗑 删除
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ background: '#1e2130', color: '#94a3b8', border: '1px solid #2d3148' }}
              >
                关闭
              </button>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
/*  end: 任务详情弹窗 */

export default function KanbanPage() {
  const { tasks, loading, fetchTasks, showDeleted, showAllDone, setShowDeleted, setShowAllDone } = useTasksStore()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  useEffect(() => {
    fetchTasks()
    // AI: 每 15 秒自动刷新
    const timer = setInterval(fetchTasks, 15000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  const tasksByStatus = COLUMNS.reduce((acc, col) => {
    acc[col] = tasks.filter(t => t.status === col)
    return acc
  }, {} as Record<TaskStatus, Task[]>)

  return (
    <div className="flex flex-col h-screen">
      {/* AI: 顶部工具栏 */}
      <div className="px-6 py-4 border-b flex-shrink-0" style={{ borderColor: '#2d3148' }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">任务看板</h1>
            <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>{tasks.length} 个任务 · 每 15s 自动刷新</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* AI: 已完成展示开关 — 已完成超过 24h 自动隐藏，打开则全展示 */}
            <button
              onClick={() => setShowAllDone(!showAllDone)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={showAllDone
                ? { background: '#1a2e2e', border: '1px solid #065f46', color: '#34d399' }
                : { background: '#1e2130', border: '1px solid #2d3148', color: '#6b7280' }}
            >
              <span className="text-sm">{showAllDone ? '✔️' : '⏳'}</span>
              全部已完成
            </button>
            {/* AI: 已删除展示开关 */}
            <button
              onClick={() => setShowDeleted(!showDeleted)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={showDeleted
                ? { background: '#2d1a1a', border: '1px solid #991b1b', color: '#f87171' }
                : { background: '#1e2130', border: '1px solid #2d3148', color: '#6b7280' }}
            >
              <span className="text-sm">{showDeleted ? '🗑️' : '👁️'}</span>
              已删除
            </button>
            <button
              onClick={() => fetchTasks()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white"
              style={{ background: '#3b82f6' }}
            >
              <Plus size={12} />
              新建任务
            </button>
          </div>
        </div>
      </div>

      {/* AI: 看板列 */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-3 p-4 min-w-max h-full">
          {COLUMNS.map(col => (
            <div key={col} className="w-60 flex flex-col flex-shrink-0">
              {/* AI: 列标题 */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-t-lg mb-1"
                style={{ background: COL_COLORS[col] + '33', border: `1px solid ${COL_COLORS[col]}44` }}
              >
                <span className="text-xs font-medium text-white">{TASK_STATUS_LABELS[col]}</span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded-full font-mono"
                  style={{ background: COL_COLORS[col] + '66', color: '#fff' }}
                >
                  {tasksByStatus[col]?.length ?? 0}
                </span>
              </div>
              {/* AI: 任务卡片 */}
              <div className="flex-1 space-y-2 overflow-y-auto">
                {tasksByStatus[col]?.map(task => (
                  <TaskCard key={task.id} task={task} onClick={() => setSelectedTask(task)} />
                ))}
                {(tasksByStatus[col]?.length === 0) && (
                  <div className="text-center py-6 text-xs" style={{ color: '#4a5568' }}>空</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreate && (
        <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={fetchTasks} />
      )}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onRefresh={fetchTasks}
        />
      )}
    </div>
  )
}
/* AI end: 任务看板页面 */
