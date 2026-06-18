/* 移动端侧边栏切换按钮组件 */
import { Menu, X } from 'lucide-react'

interface MobileSidebarToggleProps {
  isOpen: boolean
  onToggle: () => void
}

export function MobileSidebarToggle({ isOpen, onToggle }: MobileSidebarToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-surface-elevated rounded-md shadow-md"
      aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
    >
      {isOpen ? <X size={20} /> : <Menu size={20} />}
    </button>
  )
}
