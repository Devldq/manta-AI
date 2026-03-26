'use client'

import { useRouter } from 'next/navigation'
import type { Task, TaskStatus } from '@/lib/types'
import { TASK_STATUS_LABELS } from '@/lib/types'

const STATUS_COLORS: Record<TaskStatus, { color: string; bg: string }> = {
  Inbox: { color: '#4a5568', bg: '#4a556833' },
  InProgress: { color: '#2b6cb0', bg: '#2b6cb033' },
  Done: { color: '#276749', bg: '#27674933' },
  Blocked: { color: '#9b2c2c', bg: '#9b2c2c33' },
  Cancelled: { color: '#2d3748', bg: '#2d374833' },
}

interface RecentTasksProps {
  tasks: Task[]
}

export function RecentTasks({ tasks }: RecentTasksProps) {
  const router = useRouter()
  
  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="card p-5" style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: '#8892a4' }}>📋 近期任务</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {recentTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', fontSize: '12px', color: '#4a5568' }}>暂无任务</div>
        ) : (
          recentTasks.map(task => {
            const statusStyle = STATUS_COLORS[task.status]
            return (
              <div
                key={task.id}
                onClick={() => router.push(`/kanban?task=${task.id}`)}
                style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  background: '#0f1117',
                  border: '1px solid #2d3148',
                  transition: 'border-color 0.2s'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#3b82f6'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#2d3148'
                }}
              >
                <span style={{ fontSize: '14px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '12px' }}>
                  {task.title}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span 
                    style={{ 
                      fontSize: '11px', 
                      padding: '2px 8px', 
                      borderRadius: '4px',
                      background: statusStyle.bg, 
                      color: statusStyle.color 
                    }}
                  >
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                  <span style={{ fontSize: '12px', color: '#4a5568' }}>{formatTime(task.updatedAt)}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
      <button
        onClick={() => router.push('/kanban')}
        style={{ 
          width: '100%',
          marginTop: '12px',
          padding: '8px',
          fontSize: '12px',
          textAlign: 'center',
          borderRadius: '8px',
          border: 'none',
          background: 'transparent',
          color: '#8892a4',
          cursor: 'pointer',
          transition: 'color 0.2s'
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = '#fff'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = '#8892a4'
        }}
      >
        查看全部 →
      </button>
    </div>
  )
}
