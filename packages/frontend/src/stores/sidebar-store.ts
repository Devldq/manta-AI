/* Sidebar Zustand Store — 侧边栏 UI 状态管理（Tab 模式、搜索） */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TabMode = 'conversation' | 'workspace'

interface SidebarStore {
  mode: TabMode
  searchQuery: string

  setMode: (mode: TabMode) => void
  setSearchQuery: (query: string) => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      mode: 'conversation',
      searchQuery: '',

      setMode: (mode) => set({ mode }),
      setSearchQuery: (query) => set({ searchQuery: query }),
    }),
    {
      name: 'manta:sidebar',
      partialize: (state) => ({ mode: state.mode }),
    }
  )
)
