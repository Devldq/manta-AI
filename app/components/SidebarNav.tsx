/* AI start: Manta 侧边导航 — Client Component，usePathname 实现活跃高亮 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/',           label: '首页',       icon: '◎' },
  { href: '/kanban',     label: '任务看板',   icon: '▦' },
  { href: '/workflows',  label: '工作流',     icon: '⟳' },
  { href: '/processing', label: '处理中心',   icon: '◈' },
  { href: '/agents',     label: 'Agent 管理', icon: '◉' },
  { href: '/settings',   label: '设置',       icon: '◌' },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    // AI: 侧边栏容器，壁纸通过 CSS 变量 + ::before/::after 伪元素实现（见 globals.css）
    <aside
      style={{ width: 'var(--sidebar-width)' }}
      className="manta-sidebar flex flex-col border-r border-border flex-shrink-0"
    >
      {/* Logo 区域 */}
      <div
        style={{ height: 'var(--header-height)' }}
        className="flex items-center px-5 border-b border-border flex-shrink-0"
      >
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center">
            <span className="text-text-inverse text-xs font-bold">M</span>
          </div>
          <span className="text-text-primary font-semibold text-sm tracking-tight">Manta</span>
        </Link>
      </div>

      {/* 导航链接 */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          // AI: 首页精确匹配，其他页面前缀匹配
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-accent text-text-inverse'
                  : 'text-text-secondary hover:text-text-primary hover:bg-accent-subtle'
              }`}
            >
              <span
                className={`text-xs w-4 text-center ${
                  isActive ? 'text-text-inverse' : 'text-text-muted'
                }`}
              >
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* 底部版本号 */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-text-muted text-xs">Manta v2.0.0</p>
      </div>
    </aside>
  )
}
/* AI end: SidebarNav 结束 */
