'use client'

import { useState } from 'react'

interface TaskFormData {
  name: string
  description: string
  cronExpression: string
  command: string
}

interface TaskFormProps {
  onSubmit: (data: TaskFormData) => void
  onClose: () => void
}

const PRESET_SCHEDULES = [
  { label: '每分钟', value: '* * * * *' },
  { label: '每5分钟', value: '*/5 * * * *' },
  { label: '每30分钟', value: '*/30 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 00:00', value: '0 0 * * *' },
  { label: '每天 02:00', value: '0 2 * * *' },
  { label: '工作日 09:00', value: '0 9 * * 1-5' },
  { label: '每周一 00:00', value: '0 0 * * 1' },
  { label: '每月1号 00:00', value: '0 0 1 * *' },
]

export function TaskForm({ onSubmit, onClose }: TaskFormProps) {
  const [formData, setFormData] = useState<TaskFormData>({
    name: '',
    description: '',
    cronExpression: '0 0 * * *',
    command: '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
  }

  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        zIndex: 50, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        background: 'rgba(0,0,0,0.7)' 
      }}
    >
      <div 
        style={{ 
          width: '100%', 
          maxWidth: '512px', 
          borderRadius: '12px', 
          padding: '24px', 
          background: '#1e2130', 
          border: '1px solid #2d3148' 
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#3b82f6' }}>⏰</span>
            新建定时任务
          </h2>
          <button 
            onClick={onClose} 
            style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#8892a4' }}>任务名称 *</label>
            <input
              required
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              style={{ 
                width: '100%', 
                padding: '8px 12px', 
                borderRadius: '8px', 
                fontSize: '14px', 
                color: '#fff',
                background: '#0f1117', 
                border: '1px solid #2d3148',
                boxSizing: 'border-box'
              }}
              placeholder="如：每日数据备份"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#8892a4' }}>任务描述</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              style={{ 
                width: '100%', 
                padding: '8px 12px', 
                borderRadius: '8px', 
                fontSize: '14px', 
                color: '#fff',
                background: '#0f1117', 
                border: '1px solid #2d3148',
                resize: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="任务说明..."
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#8892a4' }}>执行周期</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '8px' }}>
              {PRESET_SCHEDULES.map(schedule => (
                <button
                  key={schedule.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, cronExpression: schedule.value })}
                  style={{
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    border: 'none',
                    cursor: 'pointer',
                    background: formData.cronExpression === schedule.value ? '#3b82f622' : '#0f1117',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: formData.cronExpression === schedule.value ? '#3b82f6' : '#2d3148',
                    color: formData.cronExpression === schedule.value ? '#3b82f6' : '#8892a4',
                    transition: 'all 0.2s'
                  }}
                >
                  {schedule.label}
                </button>
              ))}
            </div>
            <input
              value={formData.cronExpression}
              onChange={e => setFormData({ ...formData, cronExpression: e.target.value })}
              style={{ 
                width: '100%', 
                padding: '8px 12px', 
                borderRadius: '8px', 
                fontSize: '14px', 
                color: '#fff',
                fontFamily: 'monospace',
                background: '#0f1117', 
                border: '1px solid #2d3148',
                boxSizing: 'border-box'
              }}
              placeholder="* * * * *"
            />
            <div style={{ fontSize: '12px', marginTop: '4px', color: '#4a5568' }}>
              Cron 表达式格式：分 时 日 月 周
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: '#8892a4' }}>执行命令 *</label>
            <textarea
              required
              value={formData.command}
              onChange={e => setFormData({ ...formData, command: e.target.value })}
              rows={3}
              style={{ 
                width: '100%', 
                padding: '8px 12px', 
                borderRadius: '8px', 
                fontSize: '14px', 
                color: '#fff',
                fontFamily: 'monospace',
                background: '#0f1117', 
                border: '1px solid #2d3148',
                resize: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="如：curl http://localhost:3000/api/backup"
            />
          </div>

          <div style={{ display: 'flex', gap: '8px', paddingTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{ 
                flex: 1, 
                padding: '8px 16px', 
                borderRadius: '8px', 
                fontSize: '14px',
                background: '#2d3148', 
                color: '#a0aec0',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              style={{ 
                flex: 1, 
                padding: '8px 16px', 
                borderRadius: '8px', 
                fontSize: '14px',
                fontWeight: 500,
                color: '#fff',
                background: '#3b82f6',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              创建任务
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
