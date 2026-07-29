import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
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

const SIDEBAR_WIDTH_STORAGE_KEY = 'manta:workspace-sidebar-width'
const DEFAULT_SIDEBAR_WIDTH = 680
const MIN_SIDEBAR_WIDTH = 480
const MAX_SIDEBAR_WIDTH = 960
const MIN_MAIN_CONTENT_WIDTH = 360

function maxSidebarWidth() {
  if (typeof window === 'undefined') return MAX_SIDEBAR_WIDTH
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_MAIN_CONTENT_WIDTH))
}

function clampSidebarWidth(width: number) {
  return Math.round(Math.min(maxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)))
}

function initialSidebarWidth() {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH
  const stored = Number.parseInt(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) || '', 10)
  return clampSidebarWidth(Number.isFinite(stored) ? stored : DEFAULT_SIDEBAR_WIDTH)
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
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth)
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; currentWidth: number } | null>(null)

  useEffect(() => {
    if (previewPath && tabs.some((tab) => tab.id === 'files')) setActiveTabId('files')
  }, [previewPath, tabs])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) setActiveTabId(tabs[0]?.id ?? '')
  }, [activeTabId, tabs])

  useEffect(() => {
    const handleWindowResize = () => setSidebarWidth((current) => clampSidebarWidth(current))
    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
      document.body.classList.remove('is-resizing-workspace-sidebar')
    }
  }, [])

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

  function commitSidebarWidth(width: number) {
    const nextWidth = clampSidebarWidth(width)
    setSidebarWidth(nextWidth)
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth))
  }

  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
      currentWidth: sidebarWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing-workspace-sidebar')
  }

  function handleResizePointerMove(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resize.currentWidth = clampSidebarWidth(resize.startWidth + resize.startX - event.clientX)
    setSidebarWidth(resize.currentWidth)
  }

  function handleResizePointerEnd(event: PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    resizeRef.current = null
    document.body.classList.remove('is-resizing-workspace-sidebar')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitSidebarWidth(resize.currentWidth)
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16
    let nextWidth: number | undefined
    if (event.key === 'ArrowLeft') nextWidth = sidebarWidth + step
    if (event.key === 'ArrowRight') nextWidth = sidebarWidth - step
    if (event.key === 'Home') nextWidth = MIN_SIDEBAR_WIDTH
    if (event.key === 'End') nextWidth = maxSidebarWidth()
    if (nextWidth === undefined) return
    event.preventDefault()
    commitSidebarWidth(nextWidth)
  }

  return (
    <aside
      className="session-sidebar"
      aria-label="工作区侧边栏"
      style={{ '--session-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <div
        className="session-sidebar-resize-handle"
        role="separator"
        aria-label="调整工作区侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maxSidebarWidth()}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onKeyDown={handleResizeKeyDown}
      />
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
