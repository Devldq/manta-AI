/* 任务卡片组件 */
import { useState } from 'react'
import { MessageSquare, Clock, MoreVertical, Trash2, Edit3 } from 'lucide-react'

interface TaskCardProps {
  id: string
  title: string
  description?: string
  agentName: string
  status: 'pending' | 'in-progress' | 'completed'
  createdAt: string
  onClick?: () => void
  onDelete?: () => void
}

export function TaskCard({
  id,
  title,
  description,
  agentName,
  status,
  createdAt,
  onClick,
  onDelete
}: TaskCardProps) {
  const [showMenu, setShowMenu] = useState(false)

  const statusColors = {
    pending: 'bg-yellow-500/20 text-yellow-500',
    'in-progress': 'bg-blue-500/20 text-blue-500',
    completed: 'bg-green-500/20 text-green-500'
  }

  return (
    <div
      className="relative group bg-surface-elevated rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-text-primary truncate">{title}</h3>
          {description && (
            <p className="mt-1 text-xs text-text-muted line-clamp-2">{description}</p>
          )}
        </div>
        <div className="relative">
          <button
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface rounded transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
          >
            <MoreVertical size={16} className="text-text-muted" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 z-10 w-32 bg-surface-elevated rounded-md shadow-lg border border-border-subtle">
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-surface transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  // TODO: 编辑任务
                }}
              >
                <Edit3 size={14} />
                Edit
              </button>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-surface transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete?.()
                }}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-full text-xs ${statusColors[status]}`}>
            {status}
          </span>
          <span className="text-xs text-text-muted">{agentName}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <Clock size={12} />
          <span>{new Date(createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  )
}
