'use client'

import { memo } from 'react'
import {
  Folder, FileText, FileSearch, Search, Terminal, Pencil,
  Wrench, Loader2, Check, AlertCircle,
} from 'lucide-react'
import type { ToolCallEntry } from '../utils/types'
import { describeToolCall } from '../utils/formatters'

/** 工具名 → lucide icon 映射 */
const TOOL_ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  lsDir: Folder,
  readFile: FileText,
  glob: FileSearch,
  grep: Search,
  bash: Terminal,
  write: Pencil,
  edit: Pencil,
  multiEdit: Pencil,
}

/** 获取工具图标 */
function getToolIcon(toolName: string) {
  return TOOL_ICON_MAP[toolName] ?? Wrench
}

export const ToolCallItem = memo(function ToolCallItem({ entry }: { entry: ToolCallEntry }) {
  const isActive = entry.state === 'input-streaming' || entry.state === 'input-available'
  const isDone = entry.state === 'output-available'
  const isError = entry.state === 'output-error'
  const desc = describeToolCall(entry)
  const IconComponent = getToolIcon(entry.toolName)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '2px 6px', borderRadius: '4px',
      minHeight: '22px',
    }}>
      {/* 状态图标 */}
      {isActive ? (
        <Loader2 size={13} className="tool-spinner" style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
      ) : isDone ? (
        <Check size={13} style={{ flexShrink: 0, color: 'var(--color-status-done)' }} />
      ) : isError ? (
        <AlertCircle size={13} style={{ flexShrink: 0, color: 'var(--color-status-failed)' }} />
      ) : (
        <IconComponent size={13} style={{ flexShrink: 0, color: 'var(--color-text-muted)' }} />
      )}

      {/* 动作描述 */}
      <span style={{
        fontSize: '12px', fontFamily: 'var(--font-mono)',
        color: isActive ? 'var(--color-text-secondary)' : isError ? 'var(--color-status-failed)' : 'var(--color-text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {desc}
      </span>
    </div>
  )
})
