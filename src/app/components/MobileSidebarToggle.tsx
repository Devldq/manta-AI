'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { MobileSidebarDrawer } from './MobileSidebarDrawer'

export function MobileSidebarToggle() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* 汉堡菜单按钮 - 仅在移动端显示 */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed left-4 top-4 z-40 touch-target flex items-center justify-center rounded-lg border border-border bg-surface text-text-secondary hover:text-text-primary hover:border-accent transition-all duration-fast lg:hidden"
        aria-label="打开侧边栏"
        style={{ width: 44, height: 44 }}
      >
        <Menu size={20} />
      </button>

      {/* 移动端侧边栏抽屉 */}
      <MobileSidebarDrawer
        open={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  )
}
