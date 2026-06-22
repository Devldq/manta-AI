import { useState, useEffect, useRef, memo } from 'react'
import type { AgentEntry } from '../utils/types'
import { WorkspaceSelector, type WorkspaceEntry } from './WorkspaceSelector'

export const KimInputBar = memo(function KimInputBar({
  value,
  onChange,
  onSubmit,
  onStop,
  isLoading,
  disabled,
  agentName,
  agents,
  onAgentChange,
  workspaces = [],
  currentWorkspaceId,
  onWorkspaceChange,
  pendingFolderName,
  onFolderSelected,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onStop: () => void
  isLoading: boolean
  disabled?: boolean
  agentName: string
  agents: AgentEntry[]
  onAgentChange: (name: string) => void
  workspaces?: WorkspaceEntry[]
  currentWorkspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void
  pendingFolderName?: string
  onFolderSelected?: (folderName: string, folderPath: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [agentOpen, setAgentOpen] = useState(false)
  const agentDropRef = useRef<HTMLDivElement>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const modelDropRef = useRef<HTMLDivElement>(null)
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([])
  const [activeProfileId, setActiveProfileId] = useState<string>('')

  // 获取模型配置列表
  useEffect(() => {
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/chat/config')
        const data = await res.json()
        if (data.profiles) {
          setProfiles(data.profiles.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
          setActiveProfileId(data.activeProfileId || data.profiles[0]?.id || '')
        }
      } catch (err) {
        console.error('Failed to fetch profiles:', err)
      }
    }
    fetchProfiles()
  }, [])

  // 切换模型
  async function handleModelChange(profileId: string) {
    try {
      await fetch('/api/chat/config?action=active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      setActiveProfileId(profileId)
      setModelOpen(false)
    } catch (err) {
      console.error('Failed to switch model:', err)
    }
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [value])

  useEffect(() => {
    if (!agentOpen) return
    function outside(e: MouseEvent) {
      if (agentDropRef.current && !agentDropRef.current.contains(e.target as Node)) setAgentOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [agentOpen])

  useEffect(() => {
    if (!modelOpen) return
    function outside(e: MouseEvent) {
      if (modelDropRef.current && !modelDropRef.current.contains(e.target as Node)) setModelOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [modelOpen])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing=true 时说明输入法正在组字（中文选词），不触发提交
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!isLoading && value.trim()) onSubmit()
    }
  }

  return (
    <div className="px-4 pb-4 md:px-5 md:pb-5 flex-shrink-0">
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '16px',
        overflow: 'visible',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'box-shadow var(--duration-normal) var(--ease-out-quart), border-color var(--duration-normal) var(--ease-out-quart)',
      }}>
        {/* 顶部工具栏 */}
        <div className="flex items-center gap-1 px-3.5 pt-2.5 md:px-3.5 md:pt-2.5">
          <button className="transition-all duration-fast"
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title="@提及">
            @
          </button>
          <button className="transition-all duration-fast"
            style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '14px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-accent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
            title="附件">
            📎
          </button>
        </div>

        {/* 文本输入区 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息…"
          disabled={disabled}
          rows={3}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: '14px',
            resize: 'none',
            outline: 'none',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-primary)',
            fontFamily: 'inherit',
            lineHeight: '1.6',
            minHeight: '72px',
            maxHeight: '160px',
            display: 'block',
            boxSizing: 'border-box',
          }}
        />

        {/* 底部工具栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderTop: '1px solid var(--color-border-subtle)' }}>
          {/* 左侧：模型 / Auto / Skills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* 模型选择器 */}
            <div ref={modelDropRef} style={{ position: 'relative' }}>
              <button
                onClick={() => !disabled && setModelOpen((o) => !o)}
                className="transition-all duration-fast"
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)',
                  background: modelOpen ? 'var(--color-accent-subtle)' : 'transparent',
                  color: modelOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  cursor: disabled ? 'default' : 'pointer', fontSize: '12px', fontWeight: 500,
                }}
                onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' } }}
                onMouseLeave={(e) => { if (!disabled && !modelOpen) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
              >
                <span style={{ fontSize: '12px' }}>◎</span>
                <span>{profiles.find((p) => p.id === activeProfileId)?.name || '选择模型'}</span>
                <span style={{ fontSize: '9px', opacity: 0.6, transition: 'transform var(--duration-fast) var(--ease-out-quart)', transform: modelOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
              </button>
              {modelOpen && (
                <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 100, minWidth: '180px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', borderRadius: '10px', boxShadow: '0 4px 24px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                  {profiles.length === 0 ? (
                    <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>暂无模型</div>
                  ) : (
                    profiles.map((p) => (
                      <button key={p.id} onClick={() => handleModelChange(p.id)}
                        className="transition-colors duration-fast"
                        style={{ width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: p.id === activeProfileId ? 'var(--color-accent-subtle)' : 'transparent', color: 'var(--color-text-primary)', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onMouseEnter={(e) => { if (p.id !== activeProfileId) e.currentTarget.style.background = 'var(--color-border)' }}
                        onMouseLeave={(e) => { if (p.id !== activeProfileId) e.currentTarget.style.background = 'transparent' }}>
                        {p.id === activeProfileId && <span style={{ color: 'var(--color-accent)', fontSize: '10px' }}>✓</span>}
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{p.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <button className="transition-all duration-fast"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              <span style={{ fontSize: '11px' }}>⚡</span>
              <span>Auto</span>
              <span style={{ fontSize: '9px', opacity: 0.6 }}>▾</span>
            </button>

            <button className="transition-all duration-fast"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
              <span style={{ fontSize: '11px' }}>✦</span>
              <span>Skills</span>
            </button>
          </div>

          {/* 右侧：工作空间选择 + 发送 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <WorkspaceSelector
              workspaces={workspaces}
              currentWorkspaceId={currentWorkspaceId}
              pendingFolderName={pendingFolderName}
              onWorkspaceChange={onWorkspaceChange || (() => {})}
              onFolderSelected={onFolderSelected}
            />

            {isLoading ? (
              <button onClick={onStop}
                className="transition-all duration-fast"
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                style={{ width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-status-failed)', background: 'transparent', color: 'var(--color-status-failed)', cursor: 'pointer', fontSize: '13px', transition: 'all var(--duration-fast) var(--ease-out-quart)' }}>
                ⏹
              </button>
            ) : (
              <button onClick={onSubmit} disabled={!value.trim() || disabled}
                className="transition-all duration-fast"
                style={{
                  width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none',
                  background: value.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                  color: value.trim() ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                  cursor: value.trim() && !disabled ? 'pointer' : 'not-allowed',
                  fontSize: '14px',
                  transform: value.trim() && !disabled ? 'scale(1)' : 'scale(1)',
                  boxShadow: value.trim() && !disabled ? '0 2px 8px rgba(0, 158, 106, 0.25)' : 'none',
                }}
                onMouseEnter={(e) => { if (value.trim() && !disabled) e.currentTarget.style.transform = 'scale(1.05)' }}
                onMouseLeave={(e) => { if (value.trim() && !disabled) e.currentTarget.style.transform = 'scale(1)' }}>
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
