/* SidebarTabs — 会话 / 工作空间 Tab 切换 */
'use client'

import { useSidebarStore, type TabMode } from '@/stores/sidebar-store'

const TABS: { key: TabMode; label: string }[] = [
  { key: 'conversation', label: '会话' },
  { key: 'workspace', label: '工作空间' },
]

export function SidebarTabs() {
  const mode = useSidebarStore((s) => s.mode)
  const setMode = useSidebarStore((s) => s.setMode)

  return (
    <div className="px-3 py-2 flex-shrink-0">
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const isActive = mode === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setMode(tab.key)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                isActive
                  ? 'bg-border text-sidebar-text font-medium'
                  : 'text-text-muted hover:text-sidebar-text-secondary'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
