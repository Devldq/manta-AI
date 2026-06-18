/* 侧边栏 Tab 切换组件 */
import { MessageSquare, FolderOpen } from 'lucide-react'

interface SidebarTabsProps {
  activeTab: 'conversation' | 'workspace'
  onTabChange: (tab: 'conversation' | 'workspace') => void
}

export function SidebarTabs({ activeTab, onTabChange }: SidebarTabsProps) {
  return (
    <div className="px-3 py-2">
      <div className="flex bg-surface-elevated rounded-lg p-1">
        <button
          onClick={() => onTabChange('conversation')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === 'conversation'
              ? 'bg-accent text-text-inverse'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <MessageSquare size={14} />
          <span>Chats</span>
        </button>
        <button
          onClick={() => onTabChange('workspace')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
            activeTab === 'workspace'
              ? 'bg-accent text-text-inverse'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          <FolderOpen size={14} />
          <span>Workspaces</span>
        </button>
      </div>
    </div>
  )
}
