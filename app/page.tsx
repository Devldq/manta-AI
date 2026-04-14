/*  start: Manta 首页 — 接真实 API 数据，WorkBuddy 极简风 */
'use client'

import { useState, useEffect } from 'react'

interface TaskStats {
  running: number
  inbox: number
  doneToday: number
  total: number
}

// AI: 工作流执行概况统计
interface WfStats {
  running: number
  waiting: number
  doneToday: number
  total: number
}

interface RecentTask {
  id: string
  title: string
  status: string
  agentName?: string
  mode: string
  updatedAt: string
}

export default function HomePage() {
  const [stats, setStats] = useState<TaskStats>({ running: 0, inbox: 0, doneToday: 0, total: 0 })
  const [wfStats, setWfStats] = useState<WfStats | null>(null)
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadData() {
      try {
        // AI: 并行拉取任务列表 + 工作流执行实例
        const [tasksRes, wfRes] = await Promise.allSettled([
          fetch('/api/tasks'),
          fetch('/api/workflows/executions'),
        ])

        if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
          const data = await tasksRes.value.json()
          const tasks: RecentTask[] = data.tasks ?? []

          const today = new Date().toDateString()
          const s: TaskStats = {
            running: tasks.filter((t) => t.status === 'running').length,
            inbox: tasks.filter((t) => t.status === 'inbox').length,
            doneToday: tasks.filter(
              (t) => t.status === 'done' && new Date(t.updatedAt).toDateString() === today
            ).length,
            total: tasks.length,
          }
          setStats(s)
          setRecentTasks(tasks.slice(0, 5))
        }

        // AI: 工作流执行概况统计
        if (wfRes.status === 'fulfilled' && wfRes.value.ok) {
          const wfData = await wfRes.value.json()
          const execs: { status: string; updatedAt: string }[] = wfData.executions ?? []
          const today = new Date().toDateString()
          setWfStats({
            running: execs.filter((e) => e.status === 'running').length,
            waiting: execs.filter((e) => e.status === 'waiting').length,
            doneToday: execs.filter(
              (e) => e.status === 'done' && new Date(e.updatedAt).toDateString() === today
            ).length,
            total: execs.length,
          })
        }
      } catch {
        console.error('首页加载数据失败')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const greeting = getGreeting()

  return (
    <div className="p-8 max-w-4xl">
      {/* 顶部问候 */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Manta · Humans steer. Agents execute. Drivers are pluggable.
        </p>
      </div>

      {/* 状态概览卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-10">
        <StatCard
          label="进行中"
          value={loading ? '—' : String(stats.running)}
          color="var(--color-status-running)"
        />
        <StatCard
          label="待处理"
          value={loading ? '—' : String(stats.inbox)}
          color="var(--color-status-pending)"
        />
        <StatCard
          label="今日完成"
          value={loading ? '—' : String(stats.doneToday)}
          color="var(--color-status-done)"
        />
        <StatCard
          label="任务总数"
          value={loading ? '—' : String(stats.total)}
          color="var(--color-text-muted)"
        />
      </div>

      {/* AI: 工作流执行概况（有执行记录时显示）*/}
      {wfStats && wfStats.total > 0 && (
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">工作流概况</h2>
            <a href="/workflows" className="text-xs text-text-muted hover:text-text-primary transition-colors">
              查看编排 →
            </a>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <WfStatCard
              label="执行中"
              value={loading ? '—' : String(wfStats.running)}
              color="var(--color-status-running)"
              urgent={false}
            />
            <WfStatCard
              label="等待操作"
              value={loading ? '—' : String(wfStats.waiting)}
              color="#f59e0b"
              urgent={wfStats.waiting > 0}
            />
            <WfStatCard
              label="今日完成"
              value={loading ? '—' : String(wfStats.doneToday)}
              color="var(--color-status-done)"
              urgent={false}
            />
            <WfStatCard
              label="流程总数"
              value={loading ? '—' : String(wfStats.total)}
              color="var(--color-text-muted)"
              urgent={false}
            />
          </div>
        </div>
      )}

      {/* 快速操作区 */}
      <div className="mb-10">
        <h2 className="text-xs font-medium text-text-muted mb-3 uppercase tracking-wider">
          快速操作
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction href="/kanban" title="任务看板" description="查看并管理所有任务的执行状态" icon="▦" />
          <QuickAction href="/workflows" title="工作流编排" description="查看步骤流、执行记录和人工审批" icon="⟳" />
          <QuickAction href="/processing" title="处理中心" description="审批、打分、查看 Agent 输出" icon="◈" />
          <QuickAction href="/agents" title="Agent" description="注册和配置 Agent 执行驱动" icon="◉" />
        </div>
      </div>

      {/* 近期活动 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">近期任务</h2>
          <a href="/kanban" className="text-xs text-text-muted hover:text-text-primary transition-colors">
            查看全部 →
          </a>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-surface rounded-lg animate-pulse" />
            ))}
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="border border-dashed border-border-subtle rounded-lg p-10 text-center">
            <p className="text-text-muted text-sm">还没有任务</p>
            <a
              href="/kanban"
              className="inline-block mt-3 text-xs px-3 py-1.5 bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors"
            >
              前往看板创建第一个任务
            </a>
          </div>
        ) : (
          <div className="space-y-1.5">
            {recentTasks.map((task) => (
              <RecentTaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// AI: 问候语 — 按当前时间段显示
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '深夜了，还在工作？'
  if (h < 12) return '早上好 ☀️'
  if (h < 14) return '午间好'
  if (h < 18) return '下午好'
  if (h < 22) return '晚上好'
  return '夜深了，注意休息'
}

// AI: 工作流概况统计卡片
function WfStatCard({
  label,
  value,
  color,
  urgent,
}: {
  label: string
  value: string
  color: string
  urgent: boolean
}) {
  return (
    <div className={`border rounded-lg p-4 ${
      urgent ? 'border-yellow-300 bg-yellow-50' : 'border-border bg-surface'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted uppercase tracking-wider">{label}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${urgent ? 'animate-pulse' : ''}`} style={{ backgroundColor: color }} />
      </div>
      <div className={`text-2xl font-semibold ${
        urgent ? 'text-yellow-700' : 'text-text-primary'
      }`}>{value}</div>
    </div>
  )
}

// AI: 统计卡片
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-surface">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted uppercase tracking-wider">{label}</span>
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <div className="text-2xl font-semibold text-text-primary">{value}</div>
    </div>
  )
}

// AI: 快速操作卡片
function QuickAction({
  href,
  title,
  description,
  icon,
}: {
  href: string
  title: string
  description: string
  icon: string
}) {
  return (
    <a
      href={href}
      className="border border-border rounded-lg p-4 bg-surface hover:bg-accent-subtle hover:border-accent transition-colors group"
    >
      <div className="flex items-start gap-3">
        <span className="text-text-muted group-hover:text-text-primary transition-colors mt-0.5 text-sm">
          {icon}
        </span>
        <div>
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <div className="text-xs text-text-muted mt-0.5 leading-relaxed">{description}</div>
        </div>
      </div>
    </a>
  )
}

// AI: 近期任务行
const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  inbox:    { label: '待处理', color: 'var(--color-status-pending)' },
  planning: { label: '规划中', color: 'var(--color-status-planning)' },
  running:  { label: '进行中', color: 'var(--color-status-running)' },
  done:     { label: '已完成', color: 'var(--color-status-done)' },
  failed:   { label: '失败',   color: 'var(--color-status-failed)' },
  archived: { label: '已归档', color: 'var(--color-status-archived)' },
}

function RecentTaskRow({ task }: { task: RecentTask }) {
  const cfg = STATUS_CONFIG[task.status] ?? { label: task.status, color: 'var(--color-text-muted)' }

  return (
    <a
      href={`/processing?taskId=${task.id}`}
      className="flex items-center gap-3 px-4 py-3 bg-surface border border-border rounded-lg hover:border-accent hover:bg-accent-subtle transition-colors"
    >
      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cfg.color }} />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-text-primary truncate block">{task.title}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {task.agentName && (
          <span className="text-xs text-text-muted font-mono hidden sm:block">{task.agentName}</span>
        )}
        <span className="text-xs px-1.5 py-0.5 rounded" style={{
          backgroundColor: `${cfg.color}18`,
          color: cfg.color,
        }}>
          {cfg.label}
        </span>
        <span className="text-xs text-text-muted hidden md:block">
          {formatRelative(task.updatedAt)}
        </span>
      </div>
    </a>
  )
}

// AI: 相对时间格式化
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}m 前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h 前`
  return `${Math.floor(hours / 24)}d 前`
}
/*  end: 首页结束 */
