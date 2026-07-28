import { memo, useEffect, useRef, useState } from 'react'
import type { AgentRunSnapshot } from '@manta/contracts'
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
import {
  describeToolBatch,
  describeToolCall,
  formatToolInput,
  formatToolOutput,
  getToolFilePath,
} from '../utils/formatters'
import { formatAgentRunDuration, isAgentRunTerminal } from '../runtime/agent-run-view'

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
  if (!text.trim()) return null

  return (
    <div className="agent-thinking-block">
      <div className="agent-thinking-content">{text.trim()}</div>
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

const ToolBatch = memo(function ToolBatch({
  entries,
  onOpenFile,
}: {
  entries: ToolCallEntry[]
  onOpenFile?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = entries.some(entry =>
    entry.state === 'input-streaming' || entry.state === 'input-available'
  )
  const errorCount = entries.filter(entry => entry.state === 'output-error').length

  return (
    <div className={`tool-batch${isRunning ? ' is-running' : ''}${errorCount > 0 ? ' is-error' : ''}`}>
      <button
        type="button"
        className="tool-batch-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="tool-batch-icon" aria-hidden="true">
          {isRunning
            ? <Loader2 size={15} className="tool-spinner" />
            : errorCount > 0
              ? <AlertCircle size={15} />
              : <Wrench size={15} />}
        </span>
        <span className="tool-batch-label">{describeToolBatch(entries)}</span>
        {!isRunning && errorCount === 0 && <Check size={12} className="tool-event-check" aria-label="已完成" />}
        <span className="tool-batch-count" aria-label={`${entries.length} 个工具调用`}>
          {entries.length}
        </span>
        {expanded
          ? <ChevronDown size={14} className="tool-event-chevron" />
          : <ChevronRight size={14} className="tool-event-chevron" />}
      </button>

      {expanded && (
        <div className="tool-batch-list">
          {entries.map((entry, index) => (
            <ToolLine
              key={entry.toolCallId || `${entry.toolName}-${index}`}
              entry={entry}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  )
})

export const AgentStepView = memo(function AgentStepView({
  groups,
  isStreaming,
  agentRun,
  onOpenFile,
}: {
  groups: StepGroup[]
  isStreaming: boolean
  agentRun?: AgentRunSnapshot
  onOpenFile?: (path: string) => void
}) {
  const terminal = isAgentRunTerminal(agentRun)
  const [expanded, setExpanded] = useState(() => agentRun ? !terminal : isStreaming)
  const manuallyToggledRef = useRef(false)
  const previousTerminalRef = useRef(terminal)

  useEffect(() => {
    if (!previousTerminalRef.current && terminal && !manuallyToggledRef.current) {
      setExpanded(false)
    }
    previousTerminalRef.current = terminal
  }, [terminal])

  if (groups.length === 0 && !agentRun) return null

  const effectiveStreaming = agentRun ? !terminal : isStreaming
  const duration = formatAgentRunDuration(agentRun?.durationMs ?? agentRun?.usage?.durationMs)
  const totalTools = groups.reduce((count, group) => count + group.toolCalls.length, 0)
  const summary = effectiveStreaming
    ? `处理中${totalTools > 0 ? ` · ${totalTools} 个工具调用` : ''}`
    : `已处理${duration ? ` ${duration}` : ''}`

  return (
    <div className="tool-events">
      <button
        type="button"
        className="tool-events-summary"
        aria-expanded={expanded}
        onClick={() => {
          manuallyToggledRef.current = true
          setExpanded((value) => !value)
        }}
      >
        {effectiveStreaming ? <Loader2 size={16} className="tool-spinner" /> : <Wrench size={16} />}
        <span>{summary}</span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {expanded && (
        <div className="tool-events-list">
          {groups.map((group) => (
            <div key={group.stepIndex} className="tool-event-group">
              {group.thinking?.trim() && <ThinkingBlock text={group.thinking} />}
              {group.toolCalls.length > 1
                ? <ToolBatch entries={group.toolCalls} onOpenFile={onOpenFile} />
                : group.toolCalls.map((entry, index) => (
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
