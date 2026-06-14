/* SidebarTopBar — 顶部操作栏：菜单 + 搜索 | 新建按钮 + 快捷键 */
'use client'

import { Menu, Search, Plus } from 'lucide-react'
import { useSidebarStore, type TabMode } from '@/stores/sidebar-store'

interface SidebarTopBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onNewAction: () => void
}

export function SidebarTopBar({ searchQuery, onSearchChange, onNewAction }: SidebarTopBarProps) {
  const mode = useSidebarStore((s) => s.mode)
  const createLabel = mode === 'conversation' ? '新建会话' : '新建空间'

  return (
    <div className="px-3 pt-3 pb-2 flex-shrink-0 space-y-2">
      {/* 菜单 + 搜索 */}
      <div className="flex items-center gap-2">
        <button
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#27272a] transition-colors"
          title="菜单"
        >
          <Menu size={14} className="text-[#a1a1aa]" />
        </button>
        <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded bg-[#27272a]">
          <Search size={12} className="text-[#52525b] flex-shrink-0" />
          <input
            type="text"
            placeholder="搜索"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none text-[#fafafa] placeholder:text-[#52525b] min-w-0"
          />
        </div>
      </div>

      {/* 新建按钮 */}
      <button
        onClick={onNewAction}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-[#27272a] hover:bg-[#3f3f46] transition-colors group"
      >
        <Plus size={13} className="text-[#a1a1aa]" />
        <span className="text-xs text-[#a1a1aa] group-hover:text-[#fafafa] flex-1 text-left">{createLabel}</span>
        <span className="text-[10px] text-[#52525b]">Ctrl N</span>
      </button>
    </div>
  )
}
