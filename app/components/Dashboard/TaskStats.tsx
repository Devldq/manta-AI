'use client'

import { useRouter } from 'next/navigation'
import type { Task, TaskStatus } from '@/lib/types'
import { TASK_STATUS_LABELS } from '@/lib/types'

const STATUS_CONFIG: { key: TaskStatus; label: string; color: string; bg: string }[] = [
  { key: 'Inbox', label: '待处理', color: '#4a5568', bg: '#4a556833' },
  { key: 'InProgress', label: '进行中', color: '#2b6cb0', bg: '#2b6cb033' },
  { key: 'Done', label: '已完成', color: '#276749', bg: '#27674933' },
  { key: 'Blocked', label: '阻塞', color: '#9b2c2c', bg: '#9b2c2c33' },
]

interface TaskStatsProps {
  tasks: Task[]
}

export function TaskStats({ tasks }: TaskStatsProps) {
  const router = useRouter()
  
  const stats = STATUS_CONFIG.map(cfg => ({
    ...cfg,
    count: tasks.filter(t => t.status === cfg.key).length
  }))

  return (
    <div className="card p-5" style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: '#8892a4' }}>📊 任务概览</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {stats.map(item => (
          <button
            key={item.key}
            onClick={() => router.push(`/kanban?status=${item.key}`)}
            style={{ 
              padding: '16px', 
              borderRadius: '8px', 
              textAlign: 'center',
              background: item.bg,
              border: `1px solid ${item.color}44`,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.05)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: item.color }}>{item.count}</div>
            <div style={{ fontSize: '12px', marginTop: '4px', color: '#8892a4' }}>{item.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
