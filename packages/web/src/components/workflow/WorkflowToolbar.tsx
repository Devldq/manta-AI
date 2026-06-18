/* 工作流工具栏组件 */
import { Save, Play, Pause, RotateCcw, Undo, Redo, ZoomIn, ZoomOut, Maximize } from 'lucide-react'

interface WorkflowToolbarProps {
  workflowName: string
  onNameChange: (name: string) => void
  onSave: () => void
  onRun: () => void
  onPause: () => void
  onReset: () => void
  onUndo: () => void
  onRedo: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  isRunning?: boolean
  canUndo?: boolean
  canRedo?: boolean
}

export function WorkflowToolbar({
  workflowName,
  onNameChange,
  onSave,
  onRun,
  onPause,
  onReset,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  isRunning = false,
  canUndo = true,
  canRedo = true
}: WorkflowToolbarProps) {
  return (
    <div className="flex items-center justify-between p-3 border-b border-border-subtle bg-surface">
      {/* 左侧：工作流名称 */}
      <div className="flex items-center gap-4">
        <input
          type="text"
          value={workflowName}
          onChange={(e) => onNameChange(e.target.value)}
          className="text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-accent px-2 py-1 rounded"
          placeholder="Untitled Workflow"
        />
      </div>

      {/* 中间：编辑操作 */}
      <div className="flex items-center gap-1">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-2 hover:bg-surface-elevated rounded-md transition-colors disabled:opacity-50"
          title="Undo (Ctrl+Z)"
        >
          <Undo size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-2 hover:bg-surface-elevated rounded-md transition-colors disabled:opacity-50"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo size={16} />
        </button>
        <div className="w-px h-6 bg-border-subtle mx-2" />
        <button
          onClick={onZoomOut}
          className="p-2 hover:bg-surface-elevated rounded-md transition-colors"
          title="Zoom Out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          onClick={onZoomIn}
          className="p-2 hover:bg-surface-elevated rounded-md transition-colors"
          title="Zoom In"
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={onFitView}
          className="p-2 hover:bg-surface-elevated rounded-md transition-colors"
          title="Fit View"
        >
          <Maximize size={16} />
        </button>
      </div>

      {/* 右侧：执行操作 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onSave}
          className="flex items-center gap-2 px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors"
        >
          <Save size={16} />
          Save
        </button>
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors"
        >
          <RotateCcw size={16} />
          Reset
        </button>
        {isRunning ? (
          <button
            onClick={onPause}
            className="flex items-center gap-2 px-3 py-2 bg-yellow-500 hover:bg-yellow-600 rounded-md text-sm transition-colors"
          >
            <Pause size={16} />
            Pause
          </button>
        ) : (
          <button
            onClick={onRun}
            className="flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover rounded-md text-sm transition-colors"
          >
            <Play size={16} />
            Run
          </button>
        )}
      </div>
    </div>
  )
}
