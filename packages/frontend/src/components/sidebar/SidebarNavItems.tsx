/* SidebarNavItems — 功能导航：智能体应用、知识库、工作流 */

import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { Bot, Database, GitBranch } from 'lucide-react'

const NAV_ITEMS = [
  { href: '/apps', label: '智能体应用', icon: Bot },
  { href: '/rag', label: '知识库', icon: Database },
  { href: '/workflow', label: '工作流', icon: GitBranch },
]

export function SidebarNavItems() {
  const { pathname } = useLocation()

  return (
    <div className="px-3 pb-2 space-y-0.5 flex-shrink-0">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            to={item.href}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
              isActive
                ? 'bg-border text-sidebar-text'
                : 'text-sidebar-text-secondary hover:bg-border/50 hover:text-sidebar-text'
            }`}
          >
            <Icon size={13} className={isActive ? 'text-accent' : 'text-text-muted'} />
            <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
          </Link>
        )
      })}
    </div>
  )
}