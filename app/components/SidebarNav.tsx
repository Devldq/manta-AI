/* AI start: Manta 侧边导航 — Client Component，usePathname 实现活跃高亮 + 亮暗切换 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { setColorModeClass, getSystemColorMode } from './ThemeInitializer'
import { applyTheme, loadThemeFromStorage, getThemeById, getThemeConfig, DESIGN_THEMES, saveThemeToStorage } from '../lib/theme-presets'

const NAV_ITEMS = [
  { href: '/',           label: '首页',       icon: '◎' },
  { href: '/kanban',     label: '任务看板',   icon: '▦' },
  { href: '/workflows',  label: '工作流',     icon: '⟳' },
  { href: '/processing', label: '处理中心',   icon: '◈' },
  { href: '/agents',     label: 'Agent 管理', icon: '◉' },
  { href: '/themes',     label: '主题',       icon: '◐' },
  { href: '/settings',   label: '设置',       icon: '◌' },
]

export function SidebarNav() {
  const pathname = usePathname()
  // AI: 当前颜色模式
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    // AI: 从 localStorage 读取颜色模式
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    if (stored === 'light' || stored === 'dark') {
      setColorMode(stored)
    } else {
      setColorMode(getSystemColorMode())
    }
  }, [])

  // AI: 切换亮暗模式
  function toggleColorMode() {
    const newMode = colorMode === 'dark' ? 'light' : 'dark'
    setColorMode(newMode)
    setColorModeClass(newMode)
    localStorage.setItem('manta:color-mode', newMode)

    // AI: 同时切换当前主题的对应模式
    const saved = loadThemeFromStorage()
    const themeId = saved?.themeId ?? 'cli-pixel'
    const theme = getThemeById(themeId) ?? DESIGN_THEMES[0]
    const config = getThemeConfig(theme, newMode)
    applyTheme(config)
    saveThemeToStorage(themeId, config, newMode)
  }

  return (
    // AI: 侧边栏容器，壁纸通过 CSS 变量 + ::before/::after 伪元素实现（见 globals.css）
    <aside
      className="manta-sidebar flex flex-col flex-shrink-0"
      style={{ width: 'var(--sidebar-width)', borderRight: '1px solid var(--color-border)' }}
    >
      {/* Logo 区域 */}
      <div
        style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}
        className="flex items-center px-5 flex-shrink-0"
      >
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          {/* AI: Logo 图标 — VoltAgent 风格绿色 glow */}
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: 'var(--color-accent)',
              boxShadow: '0 0 8px var(--color-accent)',
            }}
          >
            <span style={{ color: '#050507', fontSize: '11px', fontWeight: 700 }}>M</span>
          </div>
          <span
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: 600,
              fontSize: '14px',
              letterSpacing: '-0.3px',
            }}
          >
            Manta
          </span>
        </Link>
      </div>

      {/* 导航链接 */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
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
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150"
                style={{
                  color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                  background: isActive ? 'var(--color-accent)' : 'transparent',
                  borderLeft: isActive ? '2px solid transparent' : '2px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--color-accent-subtle)'
                    e.currentTarget.style.color = 'var(--color-text-primary)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--color-text-secondary)'
                  }
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    width: '16px',
                    textAlign: 'center',
                    color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
                <span style={{ fontSize: '13px', fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* 底部：亮暗切换 + 版本号 */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <p style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>v2.0.0</p>
        {/* AI: 亮暗模式切换按钮 */}
        <button
          onClick={toggleColorMode}
          title={colorMode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          className="flex items-center gap-1.5 px-2 py-1 rounded transition-all duration-150"
          style={{
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)',
            background: 'transparent',
            fontSize: '11px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-accent)'
            e.currentTarget.style.borderColor = 'var(--color-accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
          }}
        >
          <span style={{ fontSize: '12px' }}>{colorMode === 'dark' ? '☀' : '☾'}</span>
          <span>{colorMode === 'dark' ? '亮色' : '暗色'}</span>
        </button>
      </div>
    </aside>
  )
}
/* AI end: SidebarNav 结束 */
