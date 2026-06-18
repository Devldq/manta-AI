/* 侧边栏主导航组件 */
import { useState, useCallback } from 'react'
import { SidebarTopBar } from './sidebar/SidebarTopBar'
import { SidebarTabs } from './sidebar/SidebarTabs'
import { SidebarNavItems } from './sidebar/SidebarNavItems'
import { ConversationList } from './sidebar/ConversationList'
import { WorkspaceList } from './sidebar/WorkspaceList'
import { SidebarBottomBar } from './sidebar/SidebarBottomBar'

interface SidebarNavProps {
  onSettingsClick: () => void
  onNewTaskClick: () => void
}

export function SidebarNav({ onSettingsClick, onNewTaskClick }: SidebarNavProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'conversation' | 'workspace'>('conversation')

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
  }, [])

  return (
    <div className="flex flex-col h-full bg-surface text-text-primary">
      {/* 顶部操作栏 */}
      <SidebarTopBar 
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onNewAction={onNewTaskClick}
      />

      {/* 导航项 */}
      <SidebarNavItems />

      {/* Tab 切换 */}
      <SidebarTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* 列表区域 */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'conversation' ? (
          <ConversationList searchQuery={searchQuery} />
        ) : (
          <WorkspaceList searchQuery={searchQuery} />
        )}
      </div>

      {/* 底部栏 */}
      <SidebarBottomBar onSettingsClick={onSettingsClick} />
    </div>
  )
}
