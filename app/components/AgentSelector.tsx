/* Agent 选择器组件 */
'use client'

import { useState, useEffect, useRef } from 'react'

interface AgentEntry {
  name: string
  description?: string
  enabled: boolean
}

interface AgentSelectorProps {
  currentAgent: string
  onSelect: (agentName: string) => void
  disabled?: boolean
}

export function AgentSelector({ currentAgent, onSelect, disabled }: AgentSelectorProps) {
  const [open, setOpen] = useState(false)
  const [agents, setAgents] = useState<AgentEntry[]>([])
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data) => {
        const list: AgentEntry[] = (data.agents ?? []).filter((a: AgentEntry) => a.enabled)
        setAgents(list)
      })
      .catch(() => {})
  }, [])

  // AI: 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const selected = agents.find((a) => a.name === currentAgent)

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ fontSize: '10px', color: 'var(--color-accent)' }}>◉</span>
        <span style={{ fontFamily: 'monospace' }}>{currentAgent}</span>
        {!disabled && (
          <span style={{ fontSize: '9px', color: 'var(--color-text-muted)' }}>
            {open ? '▲' : '▼'}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            minWidth: '200px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            overflow: 'hidden',
          }}
        >
          {agents.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              暂无可用 Agent
            </div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.name}
                onClick={() => {
                  onSelect(agent.name)
                  setOpen(false)
                }}
                className="w-full flex flex-col gap-0.5 px-3 py-2 text-left transition-colors"
                style={{
                  background: agent.name === currentAgent ? 'var(--color-accent-subtle)' : 'transparent',
                  color: 'var(--color-text-primary)',
                  borderBottom: '1px solid var(--color-border)',
                }}
                onMouseEnter={(e) => {
                  if (agent.name !== currentAgent) {
                    e.currentTarget.style.background = 'var(--color-accent-subtle)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (agent.name !== currentAgent) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <span style={{ fontSize: '12px', fontFamily: 'monospace', fontWeight: 500 }}>
                  {agent.name === currentAgent && '✓ '}
                  {agent.name}
                </span>
                {agent.description && (
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    {agent.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
