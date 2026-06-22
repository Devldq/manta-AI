'use client'

import { useState, useEffect, useRef, memo } from 'react'
import { createPortal } from 'react-dom'
import { Folder, FolderOpen, Check, FolderPlus, ChevronDown } from 'lucide-react'

export interface WorkspaceEntry {
  id: string
  name: string
  folderPath?: string
  taskCount?: number
}

export const WorkspaceSelector = memo(function WorkspaceSelector({
  workspaces = [],
  currentWorkspaceId,
  pendingFolderName,
  onWorkspaceChange,
  onFolderSelected,
}: {
  workspaces: WorkspaceEntry[]
  currentWorkspaceId?: string | null
  pendingFolderName?: string
  onWorkspaceChange: (workspaceId: string | null) => void
  onFolderSelected?: (folderName: string, folderPath: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [dropPos, setDropPos] = useState<{ bottom: number; right: number } | null>(null)

  const currentWs = workspaces.find((w) => w.id === currentWorkspaceId)
  const hasPendingFolder = !!pendingFolderName && !currentWs
  const displayLabel = currentWs ? currentWs.name : (pendingFolderName || '选择文件夹')
  const isActive = !!currentWs || hasPendingFolder

  // 计算 dropdown 位置
  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropPos({ bottom: window.innerHeight - rect.top + 8, right: window.innerWidth - rect.right })
    }
  }, [open])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent) {
      const target = e.target as Node
      if (dropRef.current && !dropRef.current.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  async function handlePickFolder() {
    setOpen(false)
    try {
      const api = (window as Record<string, unknown> & { electronAPI?: { openDirectory?: () => Promise<string | null> } }).electronAPI
      if (api?.openDirectory) {
        const dir = await api.openDirectory()
        if (dir) {
          const name = dir.split(/[/\\]/).pop() || dir
          onFolderSelected?.(name, dir)
        }
        return
      }
      const w = window as Record<string, unknown> & { showDirectoryPicker?: () => Promise<{ name: string }> }
      if (w.showDirectoryPicker) {
        const handle = await w.showDirectoryPicker()
        onFolderSelected?.(handle.name, handle.name)
        return
      }
      alert('当前环境不支持选择文件夹')
    } catch (err: unknown) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('选择文件夹失败:', err)
      }
    }
  }

  function handleSelectWs(wsId: string) {
    onWorkspaceChange(wsId)
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      {/* 统一下拉触发按钮 */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className="transition-all duration-fast"
        title={hasPendingFolder ? `待创建: ${pendingFolderName}` : currentWs ? `当前工作空间: ${currentWs.name}` : '选择文件夹作为工作空间'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '5px 8px 5px 10px',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
          background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
          color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
          maxWidth: '170px',
          transition: 'all var(--duration-fast) var(--ease-out-quart)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--color-accent-subtle)'
          e.currentTarget.style.borderColor = 'var(--color-accent)'
          e.currentTarget.style.color = 'var(--color-accent)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }
        }}
      >
        {currentWs ? (
          <FolderOpen size={13} style={{ flexShrink: 0 }} />
        ) : hasPendingFolder ? (
          <FolderPlus size={13} style={{ flexShrink: 0 }} />
        ) : (
          <Folder size={13} style={{ flexShrink: 0 }} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel}
        </span>
        {hasPendingFolder && (
          <span style={{
            fontSize: '9px',
            color: 'var(--color-accent)',
            background: 'var(--color-accent-subtle)',
            padding: '0 4px',
            borderRadius: '4px',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            新
          </span>
        )}
        <ChevronDown
          size={12}
          style={{
            flexShrink: 0,
            transition: 'transform var(--duration-fast) var(--ease-out-quart)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>

      {/* Portal 下拉菜单 */}
      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          style={{
            position: 'fixed',
            bottom: `${dropPos.bottom}px`,
            right: `${dropPos.right}px`,
            zIndex: 9999,
            minWidth: '200px',
            maxWidth: '280px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '6px', maxHeight: '240px', overflowY: 'auto', scrollbarWidth: 'thin' }}>
            {/* 第一行：选择新的工作空间 */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handlePickFolder()
              }}
              className="transition-colors duration-fast"
              style={{
                width: '100%',
                padding: '8px 10px',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-accent)',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '6px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-accent-subtle)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <FolderPlus size={14} />
              <span>选择新的工作空间</span>
            </button>

            {/* 分隔线 */}
            <div style={{
              margin: '4px 4px',
              height: '1px',
              background: 'var(--color-border)',
            }} />

            {/* 已有工作空间 */}
            {workspaces.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center' }}>
                暂无工作空间
              </div>
            ) : (
              workspaces.map((ws) => {
                const isActiveWs = ws.id === currentWorkspaceId
                return (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWs(ws.id)}
                    className="transition-colors duration-fast"
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      textAlign: 'left',
                      border: 'none',
                      background: isActiveWs ? 'var(--color-accent-subtle)' : 'transparent',
                      color: isActiveWs ? 'var(--color-accent)' : 'var(--color-text-primary)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      borderRadius: '6px',
                      fontWeight: isActiveWs ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActiveWs) e.currentTarget.style.background = 'var(--color-bg-secondary, #f5f5f5)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isActiveWs) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    {isActiveWs ? <FolderOpen size={13} /> : <Folder size={13} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {ws.name}
                    </span>
                    {ws.taskCount !== undefined && ws.taskCount > 0 && (
                      <span style={{
                        fontSize: '10px',
                        color: 'var(--color-text-muted)',
                        background: 'var(--color-bg-secondary, #f5f5f5)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        flexShrink: 0,
                      }}>
                        {ws.taskCount}
                      </span>
                    )}
                    {isActiveWs && <Check size={12} style={{ flexShrink: 0 }} />}
                  </button>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
})
