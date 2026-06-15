'use client'

import { 
  Save, 
  Play, 
  Trash,
  Download,
  Upload,
  ArrowLeft
} from 'lucide-react'
import { useWorkflowStore } from '@/stores/workflow-store'

interface WorkflowToolbarProps {
  onRun?: () => void
  onExport?: () => void
  onImport?: () => void
  onBack?: () => void
}

export function WorkflowToolbar({ onRun, onExport, onImport, onBack }: WorkflowToolbarProps) {
  const { 
    currentWorkflow, 
    isDirty, 
    saveWorkflow, 
    resetEditor,
    nodes 
  } = useWorkflowStore()

  const handleSave = async () => {
    await saveWorkflow()
  }

  const handleClear = () => {
    if (nodes.length === 0) return
    if (!confirm('确定要清空画布吗？此操作不可撤销。')) return
    resetEditor()
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-2 border-b"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* 左侧：返回按钮和工作流信息 */}
      <div className="flex items-center gap-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
        )}
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {currentWorkflow?.name || '新建工作流'}
          </h2>
          {currentWorkflow?.description && (
            <p
              className="text-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {currentWorkflow.description}
            </p>
          )}
        </div>
        {isDirty && (
          <span
            className="text-xs px-2 py-1 rounded"
            style={{
              background: 'var(--color-status-pending)20',
              color: 'var(--color-status-pending)',
            }}
          >
            未保存
          </span>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        {/* 画布操作 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          style={{ color: 'var(--color-text-secondary)' }}
          title="清空画布"
          onClick={handleClear}
        >
          <Trash className="w-4 h-4" />
          清空
        </button>

        {/* 分隔线 */}
        <div
          className="w-px h-6"
          style={{ background: 'var(--color-border)' }}
        />

        {/* 导入导出 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          style={{ color: 'var(--color-text-secondary)' }}
          title="导入工作流"
          onClick={onImport}
        >
          <Upload className="w-4 h-4" />
          导入
        </button>
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          style={{ color: 'var(--color-text-secondary)' }}
          title="导出工作流"
          onClick={onExport}
        >
          <Download className="w-4 h-4" />
          导出
        </button>

        {/* 分隔线 */}
        <div
          className="w-px h-6"
          style={{ background: 'var(--color-border)' }}
        />

        {/* 保存 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border"
          style={{
            borderColor: 'var(--color-border)',
            color: isDirty ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            opacity: isDirty ? 1 : 0.5,
          }}
          onClick={handleSave}
          disabled={!isDirty}
        >
          <Save className="w-4 h-4" />
          保存
        </button>

        {/* 运行 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
            opacity: nodes.length === 0 ? 0.5 : 1,
          }}
          onClick={onRun}
          disabled={nodes.length === 0}
        >
          <Play className="w-4 h-4" />
          运行
        </button>
      </div>
    </div>
  )
}
