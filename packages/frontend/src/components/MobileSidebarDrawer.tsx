import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { SidebarNav } from '@/components/sidebar/SidebarNav'

interface MobileSidebarDrawerProps {
  open: boolean
  onClose: () => void
}

export function MobileSidebarDrawer({ open, onClose }: MobileSidebarDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, onClose])

  // ESC 键关闭
  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // 阻止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{ animation: 'fadeIn 150ms ease-out' }}
      />

      {/* 抽屉内容 */}
      <div
        ref={drawerRef}
        className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-surface shadow-xl"
        style={{
          animation: 'slideInLeft 200ms ease-out',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 touch-target flex items-center justify-center rounded-md p-2 text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-fast"
          aria-label="关闭侧边栏"
        >
          <X size={18} />
        </button>

        {/* 侧边栏内容 */}
        <div className="h-full overflow-hidden">
          <SidebarNav />
        </div>
      </div>
    </div>
  )
}