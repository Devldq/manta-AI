/* 移动端侧边栏抽屉组件 */
import { useEffect } from 'react'
import { X } from 'lucide-react'

interface MobileSidebarDrawerProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}

export function MobileSidebarDrawer({ isOpen, onClose, children }: MobileSidebarDrawerProps) {
  // 防止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // ESC 键关闭
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  return (
    <>
      {/* 遮罩 */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* 抽屉 */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-surface transform transition-transform duration-300 ease-in-out lg:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 hover:bg-surface-elevated rounded-md transition-colors"
          aria-label="Close sidebar"
        >
          <X size={20} />
        </button>

        {/* 内容 */}
        <div className="h-full overflow-auto">
          {children}
        </div>
      </div>
    </>
  )
}
