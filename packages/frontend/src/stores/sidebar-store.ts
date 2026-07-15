/* Sidebar Zustand Store — 侧边栏 UI 状态管理（Tab 模式、搜索） */

import { create } from 'zustand'
import { clientState } from '@/lib/client-state'

export type TabMode = 'conversation' | 'workspace'

interface SidebarStore {
  mode: TabMode
  searchQuery: string

  setMode: (mode: TabMode) => void
  setSearchQuery: (query: string) => void
}

// Renderer UI state is intentionally ephemeral. Durable user preferences are
// stored through the backend configuration API, never by Zustand/localStorage.
export const useSidebarStore = create<SidebarStore>()((set) => ({
  mode: 'conversation', searchQuery: '',
  setMode: (mode) => { set({ mode }); void clientState.set('sidebar', { mode }) },
  setSearchQuery: (query) => set({ searchQuery: query }),
}))

export async function hydrateSidebarStore(): Promise<void> {
  const persisted = await clientState.load<{ mode?: unknown }>('sidebar')
  if (persisted?.mode === 'conversation' || persisted?.mode === 'workspace') useSidebarStore.setState({ mode: persisted.mode })
}
