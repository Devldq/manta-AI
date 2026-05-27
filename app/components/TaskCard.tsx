/* AI start: Agentic assistant — 极简任务卡片 */
'use client'

import { memo } from 'react'

export type TaskStatus = 'idle' | 'running' | 'done' | 'error'

export interface TaskCardData {
  convId: string
  title: string
  agentName: string
  status: TaskStatus
  toolCount: number
  lastActive: string
  isActive: boolean
}

interface TaskCardProps {
  task: TaskCardData
  onSelect: (convId: string) => void
  onStop?: (convId: string) => void
  index: number
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 60) return '刚刚'
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins} 分钟前`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days} 天前`
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export const TaskCard = memo(function TaskCard({ task, onSelect, onStop, index }: TaskCardProps) {
  const handleClick = () => onSelect(task.convId)

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation()
    onStop?.(task.convId)
  }

  return (
    <div
      className={`task-card ${task.isActive ? 'is-active' : ''}`}
      onClick={handleClick}
      style={{ animationDelay: `${index * 0.04}s` }}
      title={task.title}
    >
      {/* 左侧：状态点 + 内容 */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        {/* 状态指示点 */}
        <span
          className={`task-card-dot ${task.status}`}
          title={
            task.status === 'running' ? '执行中' :
            task.status === 'done' ? '已完成' :
            task.status === 'error' ? '出错了' : '待命中'
          }
          style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, marginTop: '5px',
            background:
              task.status === 'running' ? 'var(--color-accent)' :
              task.status === 'done' ? 'var(--color-status-done)' :
              task.status === 'error' ? 'var(--color-status-failed)' :
              'var(--color-text-muted)',
            opacity: task.status === 'idle' ? 0.35 : 1,
            animation: task.status === 'running' ? 'dot-breathe 2.4s var(--ease-in-out-quart) infinite' : 'none',
            transition: 'background-color var(--duration-normal) var(--ease-out-quart)',
          }}
        />

        {/* 内容区 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* 标题 */}
          <span
            style={{
              fontSize: '13px', fontWeight: 500, lineHeight: '1.45',
              color: 'var(--color-text-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}
          >
            {task.title || '未命名任务'}
          </span>

          {/* 元信息行 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--color-text-muted)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', opacity: 0.7 }}>
              {task.agentName}
            </span>
            {task.status === 'running' && (
              <span style={{ color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span className="agent-thinking-dot" />
                <span>运行</span>
              </span>
            )}
            {task.status === 'done' && (
              <span>{formatRelativeTime(task.lastActive)}</span>
            )}
            {task.status === 'error' && (
              <span style={{ color: 'var(--color-status-failed)' }}>失败</span>
            )}
            {task.status === 'idle' && (
              <span>待命中</span>
            )}
          </div>
        </div>
      </div>

      {/* 停止按钮（仅运行中 hover 显示） */}
      {task.status === 'running' && (
        <button
          className="task-card-stop-btn"
          onClick={handleStop}
          title="停止任务"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1.5" />
          </svg>
        </button>
      )}
    </div>
  )
})
