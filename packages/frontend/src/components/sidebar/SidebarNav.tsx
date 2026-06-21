/* AI start: Manta 侧边导航 — 极简深色风格，五段式布局 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { setColorModeClass, getSystemColorMode } from '@/components/ThemeInitializer'
import { applyTheme, loadThemeFromStorage, getThemeById, getThemeConfig, DESIGN_THEMES, saveThemeToStorage } from '@/lib/theme-presets'
import { SettingsModal } from '@/components/SettingsModal'
import { SidebarTopBar } from '@/components/sidebar/SidebarTopBar'
import { SidebarNavItems } from '@/components/sidebar/SidebarNavItems'
import { SidebarTabs } from '@/components/sidebar/SidebarTabs'
import { ConversationList } from '@/components/sidebar/ConversationList'
import { WorkspaceList } from '@/components/sidebar/WorkspaceList'
import { SidebarBottomBar } from '@/components/sidebar/SidebarBottomBar'
import { useSidebarStore } from '@/stores/sidebar-store'
import { useConversationStore } from '@/stores/conversation-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

export function SidebarNav() {
  const navigate = useNavigate()
  const mode = useSidebarStore((s) => s.mode)
  const searchQuery = useSidebarStore((s) => s.searchQuery)
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery)

  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    setColorMode(stored === 'light' || stored === 'dark' ? stored : getSystemColorMode())
  }, [])

  // 预触发数据加载（在组件树最顶层开始加载，而非等待子组件挂载后各自触发）
  useEffect(() => {
    useConversationStore.getState().fetchList()
    useWorkspaceStore.getState().fetchList()
  }, [])

  // 新建操作（根据 Tab 模式动态切换）
  const handleNewAction = useCallback(() => {
    if (mode === 'conversation') {
      navigate('/tasks')
    } else {
      // Phase 2: 创建新工作空间
      navigate('/workspace/new')
    }
  }, [mode, navigate])

  // 全局快捷键 Ctrl+N
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleNewAction()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewAction])

  function handleColorModeChange(newMode: 'light' | 'dark') {
    setColorMode(newMode)
    setColorModeClass(newMode)
    localStorage.setItem('manta:color-mode', newMode)
    const saved = loadThemeFromStorage()
    const themeId = saved?.themeId ?? 'cli-pixel'
    const theme = getThemeById(themeId) ?? DESIGN_THEMES[0]
    const config = getThemeConfig(theme, newMode)
    applyTheme(config)
    saveThemeToStorage(themeId, config, newMode)
  }

  return (
    <>
      <aside className="w-60 bg-surface flex flex-col h-screen flex-shrink-0">
        {/* ① 顶部操作栏 */}
        <SidebarTopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewAction={handleNewAction}
        />

        {/* ② 功能导航 */}
        <SidebarNavItems />

        {/* 分割线 */}
        <div className="mx-3 border-t border-border-subtle" />

        {/* ③ Tab 切换 */}
        <SidebarTabs />

        {/* ④ 内容列表（可滚动） */}
        <div className="flex-1 overflow-y-auto scrollbar-none">
          {mode === 'conversation' ? <ConversationList /> : <WorkspaceList />}
        </div>

        {/* ⑤ 底部用户栏 */}
        <SidebarBottomBar onSettingsClick={() => setSettingsOpen(true)} />
      </aside>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorMode={colorMode}
        onColorModeChange={handleColorModeChange}
      />
    </>
  )
}
/* AI end: SidebarNav 结束 */