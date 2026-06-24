import { useState, memo } from 'react'
import {
  ChevronRight, ChevronDown, Loader2, Check, AlertCircle,
  Folder, FileText, FileSearch, Search, Terminal, Pencil, Wrench,
} from 'lucide-react'
import type { StepGroup, ToolCallEntry } from '../utils/types'
import { describeToolCall, formatToolInput, formatToolOutput, getStepSummary, inferStepPurpose } from '../utils/formatters'

/** 工具名 → lucide icon 映射 */
const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  lsDir: Folder,
  readFile: FileText,
  glob: FileSearch,
  grep: Search,
  bash: Terminal,
  write: Pencil,
  edit: Pencil,
  multiEdit: Pencil,
}

function getToolIcon(toolName: string) {
  return TOOL_ICON_MAP[toolName] ?? Wrench
}

/** 单个工具调用的展开详情 */
const ToolCallDetail = memo(function ToolCallDetail({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const isDone = entry.state === 'output-available'
  const isError = entry.state === 'output-error'
  const Icon = getToolIcon(entry.toolName)
  const desc = describeToolCall(entry)

  return (
    <div style={{
      borderLeft: '2px solid var(--color-border)',
      marginLeft: '10px',
      paddingLeft: '10px',
      paddingTop: '4px',
      paddingBottom: '4px',
    }}>
      {/* 工具调用主行 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          cursor: 'pointer',
          padding: '2px 4px',
          borderRadius: '4px',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {entry.state === 'input-streaming' || entry.state === 'input-available' ? (
          <Loader2 size={12} className="tool-spinner" style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
        ) : isDone ? (
          <Check size={12} style={{ flexShrink: 0, color: 'var(--color-status-done)' }} />
        ) : isError ? (
          <AlertCircle size={12} style={{ flexShrink: 0, color: 'var(--color-status-failed)' }} />
        ) : (
          <Icon size={12} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
        )}

        <span style={{
          fontSize: '12px', fontFamily: 'var(--font-mono)',
          color: isError ? 'var(--color-status-failed)' : 'var(--color-text-secondary)',
          flex: 1,
        }}>
          {desc}
        </span>

        {/* 展开/收起箭头 */}
        <ChevronRight
          size={12}
          style={{
            flexShrink: 0,
            color: 'var(--color-text-muted)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        />
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div style={{
          marginTop: '4px',
          padding: '6px 8px',
          background: 'var(--color-surface)',
          borderRadius: '6px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          lineHeight: '1.5',
        }}>
          {/* 输入 */}
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>输入: </span>
            <pre style={{
              margin: '2px 0 0 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--color-text-secondary)',
              fontSize: '11px',
              maxHeight: '150px',
              overflow: 'auto',
            }}>{formatToolInput(entry)}</pre>
          </div>

          {/* 输出 */}
          <div>
            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>输出: </span>
            <pre style={{
              margin: '2px 0 0 0',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: isError ? 'var(--color-status-failed)' : 'var(--color-text-secondary)',
              fontSize: '11px',
              maxHeight: '200px',
              overflow: 'auto',
            }}>{formatToolOutput(entry)}</pre>
          </div>
        </div>
      )}
    </div>
  )
})

/** 单个步骤卡片 */
const AgentStepCard = memo(function AgentStepCard({ group, defaultExpanded }: { group: StepGroup; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? !group.isComplete)

  const purpose = group.purposeText.trim()
    ? group.purposeText.trim().slice(0, 100)
    : inferStepPurpose(group.toolCalls)

  const summary = getStepSummary(group)

  return (
    <div style={{
      border: '1px solid var(--color-border)',
      borderRadius: '8px',
      overflow: 'hidden',
      background: group.isActive ? 'var(--color-accent-subtle)' : 'transparent',
    }}>
      {/* 步骤头部：可点击折叠/展开 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded(!expanded)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* 折叠箭头 */}
        {expanded ? (
          <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
        ) : (
          <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
        )}

        {/* 步骤序号 */}
        <span style={{
          fontSize: '11px', fontWeight: 600,
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>
          Step {group.stepIndex + 1}
        </span>

        {/* 步骤目的/描述 */}
        <span style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {purpose}
        </span>

        {/* 步骤摘要（右侧） */}
        <span style={{
          fontSize: '11px',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>
          {summary}
        </span>
      </div>

      {/* 展开内容：工具调用列表 */}
      {expanded && group.toolCalls.length > 0 && (
        <div style={{ padding: '2px 8px 6px 8px' }}>
          {group.toolCalls.map((t: ToolCallEntry, i: number) => (
            <ToolCallDetail key={t.toolCallId ?? `${group.stepIndex}-${i}`} entry={t} />
          ))}
        </div>
      )}
    </div>
  )
})

/** 步骤视图容器：渲染所有步骤 */
export const AgentStepView = memo(function AgentStepView({
  groups,
  isStreaming,
}: {
  groups: StepGroup[]
  isStreaming: boolean
}) {
  if (groups.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
      {groups.map((group) => (
        <AgentStepCard
          key={group.stepIndex}
          group={group}
          defaultExpanded={isStreaming && group.isActive}
        />
      ))}
    </div>
  )
})

export default AgentStepView
