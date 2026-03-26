'use client'

import { useRouter } from 'next/navigation'

interface QuickActionsProps {
  onCreateTask?: () => void
}

export function QuickActions({ onCreateTask }: QuickActionsProps) {
  const router = useRouter()

  const actions = [
    { 
      icon: '➕', 
      label: '新建任务', 
      color: '#3b82f6', 
      onClick: onCreateTask || (() => router.push('/kanban?create=true')) 
    },
    { 
      icon: '📊', 
      label: '任务看板', 
      color: '#2b6cb0', 
      onClick: () => router.push('/kanban') 
    },
    { 
      icon: '✅', 
      label: '审批中心', 
      color: '#276749', 
      onClick: () => router.push('/approval') 
    },
  ]

  return (
    <div className="card p-5" style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: '#8892a4' }}>⚡ 快速操作</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {actions.map((action, idx) => (
          <button
            key={idx}
            onClick={action.onClick}
            style={{ 
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              borderRadius: '8px',
              textAlign: 'left',
              border: 'none',
              cursor: 'pointer',
              background: `${action.color}22`,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: `${action.color}44`,
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.opacity = '0.8'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.opacity = '1'
            }}
          >
            <span style={{ fontSize: '16px' }}>{action.icon}</span>
            <span style={{ fontSize: '14px', color: '#fff' }}>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
