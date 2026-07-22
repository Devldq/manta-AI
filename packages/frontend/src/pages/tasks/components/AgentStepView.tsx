import { memo, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileSearch,
  FileText,
  Folder,
  Loader2,
  Pencil,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { StepGroup, ToolCallEntry } from '../utils/types'
import { describeToolCall, formatToolInput, formatToolOutput, getToolFilePath } from '../utils/formatters'

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  bash: Terminal,
  edit: Pencil,
  editFile: Pencil,
  glob: FileSearch,
  grep: Search,
  listDirectory: Folder,
  lsDir: Folder,
  multiEdit: Pencil,
  readFile: FileText,
  write: Pencil,
  writeFile: Pencil,
}

const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!text.trim()) return null

  return (
    <div className="agent-thinking-block">
      <button
        type="button"
        className="agent-thinking-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>过程消息</span>
      </button>
      {expanded && <div className="agent-thinking-content">{text.trim()}</div>}
    </div>
  )
})

const ToolLine = memo(function ToolLine({ entry, onOpenFile }: { entry: ToolCallEntry; onOpenFile?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = entry.state === 'output-available'
  const isError = entry.state === 'output-error'
  const isRunning = entry.state === 'input-streaming' || entry.state === 'input-available'
  const filePath = getToolFilePath(entry)
  const Icon = TOOL_ICONS[entry.toolName] ?? Wrench

  return (
    <div className={`tool-event${isRunning ? ' is-running' : ''}${isError ? ' is-error' : ''}`}>
      <button
        type="button"
        className="tool-event-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tool-event-icon" aria-hidden="true">
          {isRunning
            ? <Loader2 size={15} className="tool-spinner" />
            : isError
              ? <AlertCircle size={15} />
              : isDone
                ? <Icon size={15} />
                : <Icon size={15} />}
        </span>
        <span className="tool-event-label">{describeToolCall(entry)}</span>
        {isDone && <Check size={12} className="tool-event-check" aria-label="已完成" />}
        {expanded ? <ChevronDown size={14} className="tool-event-chevron" /> : <ChevronRight size={14} className="tool-event-chevron" />}
      </button>

      {filePath && onOpenFile && (
        <button
          type="button"
          className="tool-event-preview"
          title={`在侧边栏预览 ${filePath}`}
          aria-label={`预览 ${filePath}`}
          onClick={() => onOpenFile(filePath)}
        >
          <Eye size={13} />
        </button>
      )}

      {expanded && (
        <div className="tool-event-detail">
          <div className="tool-event-detail-label">输入</div>
          <pre>{formatToolInput(entry)}</pre>
          <div className="tool-event-detail-label">输出</div>
          <pre>{isRunning ? '（执行中）' : formatToolOutput(entry)}</pre>
        </div>
      )}
    </div>
  )
})

export const AgentStepView = memo(function AgentStepView({
  groups,
  isStreaming,
  onOpenFile,
}: {
  groups: StepGroup[]
  isStreaming: boolean
  onOpenFile?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  if (groups.length === 0) return null

  const totalCalls = groups.reduce((sum, group) => sum + group.toolCalls.length, 0)
  const errorCount = groups.reduce(
    (sum, group) => sum + group.toolCalls.filter((entry) => entry.state === 'output-error').length,
    0,
  )
  const summary = isStreaming
    ? `正在使用工具 · ${totalCalls} 个操作`
    : `已使用工具 · ${totalCalls} 个操作${errorCount ? ` · ${errorCount} 个错误` : ''}`

  return (
    <div className="tool-events">
      <button
        type="button"
        className="tool-events-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {isStreaming ? <Loader2 size={16} className="tool-spinner" /> : <Wrench size={16} />}
        <span>{summary}</span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {expanded && (
        <div className="tool-events-list">
          {groups.map((group) => (
            <div key={group.stepIndex} className="tool-event-group">
              {group.thinking?.trim() && <ThinkingBlock text={group.thinking} />}
              {group.toolCalls.map((entry, index) => (
                <ToolLine
                  key={entry.toolCallId || `${group.stepIndex}-${index}`}
                  entry={entry}
                  onOpenFile={onOpenFile}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

export default AgentStepView
