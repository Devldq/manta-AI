import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import {
  composeSessionSidebarTabs,
  type SessionSidebarContext,
  type SessionSidebarTabDefinition,
} from './session-sidebar/tabs'

interface Conversation {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  messages: Array<{ id: string; role: string; content: string; timestamp: string }>
}

interface SessionSidebarProps {
  open: boolean
  conversation: Conversation | null
  workspaceId?: string | null
  previewPath?: string | null
  onClose?: () => void
  tabs?: readonly SessionSidebarTabDefinition[]
}

export function SessionSidebar({
  open,
  conversation,
  workspaceId,
  previewPath,
  onClose,
  tabs: extensionTabs = [],
}: SessionSidebarProps) {
  const tabs = useMemo(() => composeSessionSidebarTabs(extensionTabs), [extensionTabs])
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? '')

  useEffect(() => {
    if (previewPath && tabs.some((tab) => tab.id === 'files')) setActiveTabId('files')
  }, [previewPath, tabs])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[0]?.id ?? '')
  }, [activeTabId, tabs])

  if (!open) return null

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const ActiveComponent = activeTab?.component
  const context: SessionSidebarContext = {
    workspaceId: workspaceId ?? null,
    conversationId: conversation?.id ?? null,
    previewPath: previewPath ?? null,
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tabIndex: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (tabIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (tabIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    setActiveTabId(tabs[nextIndex].id)
    document.getElementById(`workspace-tab-${tabs[nextIndex].id}`)?.focus()
  }

  return (
    <aside className="session-sidebar" aria-label="工作区侧边栏">
      <header className="session-sidebar-header">
        <div className="session-sidebar-heading">
          <span className="session-sidebar-title">工作区</span>
          {workspaceId ? <span className="session-sidebar-connection">已绑定</span> : null}
        </div>
        {onClose ? (
          <button type="button" className="session-sidebar-close" onClick={onClose} aria-label="关闭工作区侧边栏">
            <X size={15} />
          </button>
        ) : null}
      </header>

      <div className="session-sidebar-tabs" role="tablist" aria-label="工作区工具">
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab?.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              id={`workspace-tab-${tab.id}`}
              type="button"
              role="tab"
              className="session-sidebar-tab"
              aria-selected={selected}
              aria-controls={`workspace-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTabId(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {activeTab && ActiveComponent ? (
        <section
          id={`workspace-panel-${activeTab.id}`}
          className="session-sidebar-panel"
          role="tabpanel"
          aria-labelledby={`workspace-tab-${activeTab.id}`}
          tabIndex={0}
        >
          <ActiveComponent {...context} />
        </section>
      ) : null}
    </aside>
  )
}

export type { SessionSidebarTabDefinition } from './session-sidebar/tabs'
