/* Sidebar Zustand Store — 侧边栏 UI 状态管理 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TabMode = 'conversation' | 'workspace'

interface SidebarStore {
  searchQuery: string
  mode: TabMode

  setSearchQuery: (query: string) => void
  setMode: (mode: TabMode) => void
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      searchQuery: '',
      mode: 'conversation',

      setSearchQuery: (query) => set({ searchQuery: query }),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'manta:sidebar',
      partialize: (state) => ({ mode: state.mode }), // 持久化 tab 选择
    }
  )
)

