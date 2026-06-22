'use client'

import { useState, useEffect, useRef, memo } from 'react'
import { Folder, FolderOpen, Plus, Check } from 'lucide-react'

export interface WorkspaceEntry {
  id: string
  name: string
  folderPath?: string
  taskCount?: number
}

export const WorkspaceSelector = memo(function WorkspaceSelector({
  workspaces = [],
  currentWorkspaceId,
  onWorkspaceChange,
  onCreateWorkspace,
}: {
  workspaces: WorkspaceEntry[]
  currentWorkspaceId?: string | null
  onWorkspaceChange: (workspaceId: string | null) => void
  onCreateWorkspace?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [newDialog, setNewDialog] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPath, setNewPath] = useState('')
  const [creating, setCreating] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const currentWs = workspaces.find((w) => w.id === currentWorkspaceId)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
        setNewDialog(false)
      }
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  // 新建对话框打开时聚焦输入框
  useEffect(() => {
    if (newDialog && inputRef.current) {
      inputRef.current.focus()
    }
  }, [newDialog])

  async function handleCreate() {
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folderPath: newPath.trim() || undefined }),
      })
      const json = await res.json()
      if (json.success && json.data?.workspace) {
        onWorkspaceChange(json.data.workspace.id)
        setNewDialog(false)
        setNewName('')
        setNewPath('')
        setOpen(false)
        onCreateWorkspace?.()
      }
    } catch {
      // 忽略
    } finally {
      setCreating(false)
    }
  }

  const recentWorkspaces = workspaces.slice(0, 10)

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      {/* 触发按钮 */}
      <button
        onClick={() => !newDialog && setOpen((o) => !o)}
        className="transition-all duration-fast"
        title={currentWs ? `当前工作空间: ${currentWs.name}` : '选择工作空间'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '5px 10px',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
          background: open || currentWs ? 'var(--color-accent-subtle)' : 'transparent',
          color: open || currentWs ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
          maxWidth: '180px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--color-accent-subtle)'
          e.currentTarget.style.borderColor = 'var(--color-accent)'
          e.currentTarget.style.color = 'var(--color-accent)'
        }}
        onMouseLeave={(e) => {
          if (!open && !currentWs) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }
        }}
      >
        {currentWs ? (
          <>
            <FolderOpen size={13} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100px',
              }}
            >
              {currentWs.name}
            </span>
          </>
        ) : (
          <>
            <Folder size={13} />
            <span>选择文件夹</span>
          </>
        )}
        <span
          style={{
            fontSize: '9px',
            opacity: 0.6,
            transition: 'transform var(--duration-fast) var(--ease-out-quart)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▾
        </span>
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            right: 0,
            zIndex: 100,
            minWidth: '240px',
            maxWidth: '320px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
        >
          {newDialog ? (
            /* 新建工作空间表单 */
            <div style={{ padding: '14px' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  marginBottom: '12px',
                }}
              >
                新建工作空间
              </div>
              <div style={{ marginBottom: '10px' }}>
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') {
                      setNewDialog(false)
                      setNewName('')
                      setNewPath('')
                    }
                  }}
                  placeholder="工作空间名称"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary, #f5f5f5)',
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                  }}
                />
              </div>
              <div style={{ marginBottom: '12px' }}>
                <input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') {
                      setNewDialog(false)
                      setNewName('')
                      setNewPath('')
                    }
                  }}
                  placeholder="文件夹路径 (选填)"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-secondary, #f5f5f5)',
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setNewDialog(false)
                    setNewName('')
                    setNewPath('')
                  }}
                  className="transition-all duration-fast"
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-bg-secondary, #f5f5f5)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim() || creating}
                  className="transition-all duration-fast"
                  style={{
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 500,
                    borderRadius: '6px',
                    border: 'none',
                    background: newName.trim() && !creating
                      ? 'var(--color-accent)'
                      : 'var(--color-border)',
                    color: newName.trim() && !creating
                      ? 'var(--color-text-inverse)'
                      : 'var(--color-text-muted)',
                    cursor: newName.trim() && !creating ? 'pointer' : 'not-allowed',
                  }}
                >
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 当前工作空间提示 */}
              {currentWs && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--color-text-muted)',
                      marginBottom: '4px',
                    }}
                  >
                    当前工作空间
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      fontWeight: 500,
                      color: 'var(--color-accent)',
                    }}
                  >
                    <FolderOpen size={14} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {currentWs.name}
                    </span>
                    <Check size={12} style={{ marginLeft: 'auto', flexShrink: 0 }} />
                  </div>
                </div>
              )}

              {/* 最近的工作空间 */}
              <div style={{ padding: '6px' }}>
                <div
                  style={{
                    padding: '4px 8px 4px',
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  最近的工作空间
                </div>
                {recentWorkspaces.length === 0 ? (
                  <div
                    style={{
                      padding: '10px 12px',
                      fontSize: '12px',
                      color: 'var(--color-text-muted)',
                      textAlign: 'center',
                    }}
                  >
                    暂无工作空间
                  </div>
                ) : (
                  recentWorkspaces.map((ws) => {
                    const isActive = ws.id === currentWorkspaceId
                    return (
                      <button
                        key={ws.id}
                        onClick={() => {
                          onWorkspaceChange(ws.id)
                          setOpen(false)
                        }}
                        className="transition-colors duration-fast"
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          textAlign: 'left',
                          border: 'none',
                          background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                          color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                          fontSize: '13px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          borderRadius: '6px',
                          fontWeight: isActive ? 600 : 400,
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'var(--color-bg-secondary, #f5f5f5)'
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        {isActive ? <FolderOpen size={14} /> : <Folder size={14} />}
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {ws.name}
                        </span>
                        {ws.taskCount !== undefined && ws.taskCount > 0 && (
                          <span
                            style={{
                              fontSize: '10px',
                              color: 'var(--color-text-muted)',
                              background: 'var(--color-bg-secondary, #f5f5f5)',
                              padding: '1px 6px',
                              borderRadius: '10px',
                              flexShrink: 0,
                            }}
                          >
                            {ws.taskCount}
                          </span>
                        )}
                        {isActive && <Check size={12} style={{ flexShrink: 0 }} />}
                      </button>
                    )
                  })
                )}
              </div>

              {/* 底部分隔 + 打开文件夹 */}
              <div
                style={{
                  borderTop: '1px solid var(--color-border-subtle)',
                  padding: '4px',
                }}
              >
                <button
                  onClick={() => {
                    setNewDialog(true)
                  }}
                  className="transition-colors duration-fast"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-accent)',
                    fontSize: '13px',
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
                  <Plus size={14} />
                  <span>打开文件夹</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
})
