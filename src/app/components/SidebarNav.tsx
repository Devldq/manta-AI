/* AI start: Manta 侧边导航 — 极简深色风格，五段式布局 */
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { setColorModeClass, getSystemColorMode } from './ThemeInitializer'
import { applyTheme, loadThemeFromStorage, getThemeById, getThemeConfig, DESIGN_THEMES, saveThemeToStorage } from '../lib/theme-presets'
import { SettingsModal } from './SettingsModal'
import { SidebarTopBar } from './sidebar/SidebarTopBar'
import { SidebarNavItems } from './sidebar/SidebarNavItems'
import { SidebarTabs } from './sidebar/SidebarTabs'
import { ConversationList } from './sidebar/ConversationList'
import { WorkspaceList } from './sidebar/WorkspaceList'
import { SidebarBottomBar } from './sidebar/SidebarBottomBar'
import { useSidebarStore } from '@/stores/sidebar-store'

export function SidebarNav() {
  const router = useRouter()
  const mode = useSidebarStore((s) => s.mode)
  const searchQuery = useSidebarStore((s) => s.searchQuery)
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery)

  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    setColorMode(stored === 'light' || stored === 'dark' ? stored : getSystemColorMode())
  }, [])

  // 新建操作（根据 Tab 模式动态切换）
  const handleNewAction = useCallback(() => {
    if (mode === 'conversation') {
      router.push('/tasks')
    } else {
      // Phase 2: 创建新工作空间
      router.push('/workspace/new')
    }
  }, [mode, router])

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
      <aside className="w-60 bg-[#18181b] flex flex-col h-screen flex-shrink-0">
        {/* ① 顶部操作栏 */}
        <SidebarTopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewAction={handleNewAction}
        />

        {/* ② 功能导航 */}
        <SidebarNavItems />

        {/* 分割线 */}
        <div className="mx-3 border-t border-[#27272a]" />

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
