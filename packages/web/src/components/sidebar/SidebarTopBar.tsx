/* 侧边栏顶部操作栏组件 */
import { Search, Plus } from 'lucide-react'

interface SidebarTopBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onNewAction: () => void
}

export function SidebarTopBar({ searchQuery, onSearchChange, onNewAction }: SidebarTopBarProps) {
  return (
    <div className="p-3 border-b border-border-subtle">
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" size={16} />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <button
          onClick={onNewAction}
          className="p-1.5 bg-accent hover:bg-accent-hover rounded-md transition-colors"
          title="New Task (Ctrl+N)"
        >
          <Plus size={16} className="text-text-inverse" />
        </button>
      </div>
    </div>
  )
}
