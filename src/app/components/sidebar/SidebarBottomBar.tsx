/* SidebarBottomBar — 底部用户栏：头像 + 名称 | 设置 */
'use client'

import { Settings } from 'lucide-react'

interface SidebarBottomBarProps {
  onSettingsClick: () => void
}

export function SidebarBottomBar({ onSettingsClick }: SidebarBottomBarProps) {
  return (
    <div className="px-3 py-2 border-t border-[#27272a] flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* 头像占位 */}
        <div className="w-6 h-6 rounded-full bg-[#27272a] flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] text-[#a1a1aa] font-medium">M</span>
        </div>
        <span className="text-xs text-[#a1a1aa]">Manta</span>
      </div>
      <button
        onClick={onSettingsClick}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#27272a] transition-colors"
        title="设置"
      >
        <Settings size={13} className="text-[#52525b]" />
      </button>
    </div>
  )
}
