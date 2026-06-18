/* 侧边栏导航项组件 */
import { useNavigate, useLocation } from 'react-router-dom'
import { MessageSquare, AppWindow, Settings, Palette, FolderOpen, Workflow, Plug, Database, BarChart3 } from 'lucide-react'

export function SidebarNavItems() {
  const navigate = useNavigate()
  const location = useLocation()

  const navItems = [
    { path: '/tasks', label: 'Tasks', icon: MessageSquare },
    { path: '/apps', label: 'Apps', icon: AppWindow },
    { path: '/workspace', label: 'Workspace', icon: FolderOpen },
    { path: '/workflow', label: 'Workflow', icon: Workflow },
    { path: '/mcp', label: 'MCP', icon: Plug },
    { path: '/rag', label: 'RAG', icon: Database },
    { path: '/evaluation', label: 'Evaluation', icon: BarChart3 },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/themes', label: 'Themes', icon: Palette },
  ]

  return (
    <nav className="px-3 py-2 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = location.pathname === item.path || 
                        (item.path === '/tasks' && location.pathname === '/')
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-left ${
              isActive
                ? 'bg-accent text-text-inverse'
                : 'text-text-secondary hover:bg-surface-elevated'
            }`}
          >
            <Icon size={18} />
            <span className="text-sm">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
