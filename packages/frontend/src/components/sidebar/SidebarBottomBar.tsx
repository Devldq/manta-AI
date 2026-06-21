/* SidebarBottomBar — 底部用户栏：头像 + 名称 | 设置 */

import { Settings } from 'lucide-react'

interface SidebarBottomBarProps {
  onSettingsClick: () => void
}

export function SidebarBottomBar({ onSettingsClick }: SidebarBottomBarProps) {
  return (
    <div className="px-3 py-2 border-t border-sidebar-border flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* 头像占位 */}
        <div className="w-6 h-6 rounded-full bg-border flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-sidebar-text-secondary font-medium">M</span>
        </div>
        <span className="text-xs text-sidebar-text-secondary">Manta</span>
      </div>
      <button
        onClick={onSettingsClick}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-border transition-colors"
        title="设置22"
      >
        <Settings size={13} className="text-text-muted" />
      </button>
    </div>
  )
}