'use client'

import { useEffect, useState } from 'react'
import { TaskForm } from './components/TaskForm'

interface CronTask {
  id: string
  name: string
  description?: string
  cronExpression: string
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: 'success' | 'failed' | 'running'
  nextRunAt?: string
  runCount: number
}

interface ExecutionRecord {
  id: string
  taskName: string
  startedAt: string
  status: 'success' | 'failed' | 'running'
  duration?: number
}

type FilterType = 'all' | 'running' | 'paused' | 'failed'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  running: { label: '运行中', color: '#22c55e', bg: '#0d1f18' },
  paused: { label: '已暂停', color: '#f59e0b', bg: '#1a1510' },
  failed: { label: '失败', color: '#ef4444', bg: '#2d1515' },
}

function formatDuration(ms?: number) {
  if (!ms) return '--'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function parseCronExpression(expr: string): string {
  const commonPatterns: Record<string, string> = {
    '0 0 * * *': '每天 00:00',
    '0 2 * * *': '每天 02:00',
    '0 9 * * 1-5': '工作日 09:00',
    '0 */6 * * *': '每6小时',
    '*/30 * * * *': '每30分钟',
    '*/5 * * * *': '每5分钟',
    '0 * * * *': '每小时',
    '0 0 * * 1': '每周一 00:00',
    '0 0 1 * *': '每月1号 00:00',
  }
  return commonPatterns[expr] || expr
}

export default function CronPage() {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [executions, setExecutions] = useState<ExecutionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showForm, setShowForm] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [tasksRes, execRes] = await Promise.all([
        fetch('/api/cron'),
        fetch('/api/cron/executions?limit=10')
      ])
      const [tasksData, execData] = await Promise.all([
        tasksRes.json(),
        execRes.json()
      ])
      setTasks(tasksData)
      setExecutions(execData)
    } catch (error) {
      console.error('Failed to fetch:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 30000)
    return () => clearInterval(timer)
  }, [])

  const handleCreateTask = async (formData: { name: string; description: string; cronExpression: string; command: string }) => {
    try {
      const res = await fetch('/api/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      if (res.ok) {
        setShowForm(false)
        fetchData()
      }
    } catch (error) {
      console.error('Failed to create task:', error)
    }
  }

  const handleToggle = async (task: CronTask) => {
    try {
      await fetch(`/api/cron/${task.id}/toggle`, { method: 'POST' })
      fetchData()
    } catch (error) {
      console.error('Failed to toggle:', error)
    }
  }

  const handleRunNow = async (taskId: string) => {
    try {
      await fetch(`/api/cron/${taskId}/run`, { method: 'POST' })
      fetchData()
    } catch (error) {
      console.error('Failed to run:', error)
    }
  }

  const handleDelete = async (taskId: string) => {
    if (!confirm('确定删除此任务？')) return
    try {
      await fetch(`/api/cron/${taskId}`, { method: 'DELETE' })
      fetchData()
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true
    if (filter === 'running') return task.enabled && task.lastRunStatus !== 'failed'
    if (filter === 'paused') return !task.enabled
    if (filter === 'failed') return task.lastRunStatus === 'failed'
    return true
  })

  const stats = {
    total: tasks.length,
    running: tasks.filter(t => t.enabled).length,
    paused: tasks.filter(t => !t.enabled).length,
    failed: tasks.filter(t => t.lastRunStatus === 'failed').length,
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>⏰</div>
          <p style={{ color: '#8892a4', marginTop: '16px' }}>加载定时任务...</p>
        </div>
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'running', label: '运行中' },
    { key: 'paused', label: '已暂停' },
    { key: 'failed', label: '失败' },
  ]

  return (
    <div style={{ minHeight: '100vh', padding: '24px', background: '#0f1117' }}>
      <div style={{ maxWidth: '1024px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>⏰</span>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', margin: 0 }}>定时任务</h1>
              <p style={{ fontSize: '12px', color: '#8892a4', margin: '4px 0 0 0' }}>Cron 任务管理 · 自动调度</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={fetchData}
              style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#1e2130',
                border: '1px solid #2d3148',
                color: '#8892a4',
                cursor: 'pointer'
              }}
            >
              <span>🔄</span>
              刷新
            </button>
            <button
              onClick={() => setShowForm(true)}
              style={{ 
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '14px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <span>➕</span>
              新建任务
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
          <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{stats.total}</div>
            <div style={{ fontSize: '12px', color: '#8892a4' }}>总任务</div>
          </div>
          <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#22c55e' }}>{stats.running}</div>
            <div style={{ fontSize: '12px', color: '#8892a4' }}>运行中</div>
          </div>
          <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>{stats.paused}</div>
            <div style={{ fontSize: '12px', color: '#8892a4' }}>已暂停</div>
          </div>
          <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ef4444' }}>{stats.failed}</div>
            <div style={{ fontSize: '12px', color: '#8892a4' }}>失败</div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {filterOptions.map(option => (
            <button
              key={option.key}
              onClick={() => setFilter(option.key)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                border: 'none',
                cursor: 'pointer',
                background: filter === option.key ? '#3b82f622' : '#0f1117',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: filter === option.key ? '#3b82f6' : '#2d3148',
                color: filter === option.key ? '#3b82f6' : '#8892a4'
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Task List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {filteredTasks.length === 0 ? (
            <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '32px', textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏰</div>
              <div style={{ fontSize: '14px', color: '#fff', marginBottom: '4px' }}>暂无定时任务</div>
              <div style={{ fontSize: '12px', color: '#4a5568' }}>点击右上角"新建任务"创建第一个定时任务</div>
            </div>
          ) : (
            filteredTasks.map(task => {
              const status = task.enabled 
                ? (task.lastRunStatus === 'failed' ? 'failed' : 'running')
                : 'paused'
              const statusCfg = STATUS_CONFIG[status]
              
              return (
                <div key={task.id} style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 500, color: '#fff' }}>{task.name}</span>
                        <span 
                          style={{ 
                            fontSize: '12px', 
                            padding: '2px 8px', 
                            borderRadius: '4px',
                            background: statusCfg.bg, 
                            color: statusCfg.color 
                          }}
                        >
                          {statusCfg.label}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', marginBottom: '4px', color: '#8892a4' }}>
                        {task.description}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: '#4a5568' }}>
                        <span>🕐 {parseCronExpression(task.cronExpression)}</span>
                        {task.nextRunAt && <span>下次: {new Date(task.nextRunAt).toLocaleString('zh-CN')}</span>}
                        <span>执行: {task.runCount} 次</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        onClick={() => handleToggle(task)}
                        style={{ 
                          padding: '8px', 
                          borderRadius: '6px',
                          background: '#0f1117',
                          color: task.enabled ? '#f59e0b' : '#22c55e',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                        title={task.enabled ? '暂停' : '启动'}
                      >
                        {task.enabled ? '⏸️' : '▶️'}
                      </button>
                      <button 
                        onClick={() => handleRunNow(task.id)}
                        style={{ 
                          padding: '8px', 
                          borderRadius: '6px',
                          background: '#0f1117',
                          color: '#3b82f6',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                        title="立即执行"
                      >
                        🔄
                      </button>
                      <button 
                        style={{ 
                          padding: '8px', 
                          borderRadius: '6px',
                          background: '#0f1117',
                          color: '#8892a4',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                        title="编辑"
                      >
                        ✏️
                      </button>
                      <button 
                        onClick={() => handleDelete(task.id)}
                        style={{ 
                          padding: '8px', 
                          borderRadius: '6px',
                          background: '#0f1117',
                          color: '#ef4444',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Execution History */}
        <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px' }}>
          <h3 style={{ fontSize: '14px', color: '#8892a4', margin: '0 0 12px 0' }}>
            📜 最近执行记录
          </h3>
          {executions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', fontSize: '12px', color: '#4a5568' }}>
              暂无执行记录
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#4a5568' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0' }}>时间</th>
                  <th style={{ textAlign: 'left', padding: '8px 0' }}>任务</th>
                  <th style={{ textAlign: 'left', padding: '8px 0' }}>状态</th>
                  <th style={{ textAlign: 'left', padding: '8px 0' }}>耗时</th>
                </tr>
              </thead>
              <tbody>
                {executions.map(exec => (
                  <tr key={exec.id} style={{ borderTop: '1px solid #2d3148' }}>
                    <td style={{ padding: '8px 0', color: '#8892a4' }}>
                      {new Date(exec.startedAt).toLocaleString('zh-CN')}
                    </td>
                    <td style={{ padding: '8px 0', color: '#fff' }}>{exec.taskName}</td>
                    <td style={{ padding: '8px 0' }}>
                      <span 
                        style={{
                          fontSize: '12px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: exec.status === 'success' ? '#0d1f18' : exec.status === 'failed' ? '#2d1515' : '#1a1d2e',
                          color: exec.status === 'success' ? '#22c55e' : exec.status === 'failed' ? '#ef4444' : '#8892a4'
                        }}
                      >
                        {exec.status === 'success' ? '✅ 成功' : exec.status === 'failed' ? '❌ 失败' : '⏳ 运行中'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 0', color: '#8892a4' }}>
                      {formatDuration(exec.duration)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <TaskForm 
          onSubmit={handleCreateTask}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  )
}
