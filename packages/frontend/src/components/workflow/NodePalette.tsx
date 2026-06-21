import { 
  Bot, 
  User, 
  GitBranch, 
  Split, 
  RotateCw,
  GripVertical 
} from 'lucide-react'
import type { WorkflowStepType } from '@manta/shared'

interface NodeTypeInfo {
  type: WorkflowStepType
  name: string
  description: string
  icon: React.ReactNode
  color: string
}

const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: 'agent',
    name: '智能体',
    description: '调用AI智能体执行任务',
    icon: <Bot className="w-5 h-5" />,
    color: 'var(--color-accent)',
  },
  {
    type: 'human_in_loop',
    name: '人工审核',
    description: '暂停等待人工操作',
    icon: <User className="w-5 h-5" />,
    color: 'var(--color-status-pending)',
  },
  {
    type: 'parallel',
    name: '并行执行',
    description: '同时执行多个分支',
    icon: <Split className="w-5 h-5" />,
    color: 'var(--color-status-done)',
  },
  {
    type: 'conditional',
    name: '条件判断',
    description: '根据条件选择分支',
    icon: <GitBranch className="w-5 h-5" />,
    color: 'var(--color-status-running)',
  },
  {
    type: 'loop',
    name: '循环',
    description: '重复执行直到条件满足',
    icon: <RotateCw className="w-5 h-5" />,
    color: 'var(--color-emphasis)',
  },
]

interface NodePaletteProps {
  onDragStart: (type: WorkflowStepType) => void
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  return (
    <div
      className="w-64 border-r flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h3
          className="font-semibold text-sm"
          style={{ color: 'var(--color-text-primary)' }}
        >
          节点类型
        </h3>
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--color-text-muted)' }}
        >
          拖拽节点到画布
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {NODE_TYPES.map((nodeType) => (
          <div
            key={nodeType.type}
            className="flex items-center gap-3 p-3 rounded-lg cursor-grab active:cursor-grabbing hover:opacity-80 transition-opacity"
            style={{
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-border-subtle)',
            }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('nodeType', nodeType.type)
              onDragStart(nodeType.type)
            }}
          >
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ 
                background: `${nodeType.color}20`,
                color: nodeType.color,
              }}
            >
              {nodeType.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="font-medium text-sm"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {nodeType.name}
              </div>
              <div
                className="text-xs truncate"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {nodeType.description}
              </div>
            </div>
            <GripVertical 
              className="w-4 h-4 flex-shrink-0" 
              style={{ color: 'var(--color-text-muted)' }} 
            />
          </div>
        ))}
      </div>
    </div>
  )
}
