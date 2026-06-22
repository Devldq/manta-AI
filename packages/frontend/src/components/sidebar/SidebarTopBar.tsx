/* SidebarTopBar — 顶部操作栏：菜单 + 搜索 | 新建按钮 + 快捷键 */

import { Menu, Search, Plus } from 'lucide-react'

interface SidebarTopBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onNewAction: () => void
}

export function SidebarTopBar({ searchQuery, onSearchChange, onNewAction }: SidebarTopBarProps) {
  return (
    <div className="px-3 pt-3 pb-2 flex-shrink-0 space-y-2">
      {/* 菜单 + 搜索 */}
      <div className="flex items-center gap-2">
        <button
          className="w-7 h-7 flex items-center justify-center rounded hover:bg-sidebar-border transition-colors"
          title="菜单"
        >
          <Menu size={14} className="text-sidebar-text-secondary" />
        </button>
        <div className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded bg-sidebar-border">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="搜索"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none text-sidebar-text placeholder:text-text-muted min-w-0"
          />
        </div>
      </div>

      {/* 新建按钮 */}
      <button
        onClick={onNewAction}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-sidebar-border hover:bg-border transition-colors group"
      >
        <Plus size={13} className="text-sidebar-text-secondary" />
        <span className="text-xs text-sidebar-text-secondary group-hover:text-sidebar-text flex-1 text-left">新建任务</span>
        <span className="text-[10px] text-text-muted">Ctrl N</span>
      </button>
    </div>
  )
}