/* AI start: ThemeInitializer — 全局主题初始化 Client Component
 * 在根布局挂载，从 localStorage 读取并通过 CSS 变量应用主题配置
 * 任何页面进入时都能生效，无需进入设置页
 */
'use client'

import { useEffect } from 'react'

export function ThemeInitializer() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem('manta:theme')
      if (!saved) return
      const parsed = JSON.parse(saved)
      const config = parsed.config
      if (!config) return

      const root = document.documentElement

      // AI: 基础颜色
      if (config.background)       root.style.setProperty('--color-background', config.background)
      if (config.surface)          root.style.setProperty('--color-surface', config.surface)
      if (config.surfaceElevated)  root.style.setProperty('--color-surface-elevated', config.surfaceElevated)
      if (config.border)           root.style.setProperty('--color-border', config.border)
      if (config.borderSubtle)     root.style.setProperty('--color-border-subtle', config.borderSubtle)
      if (config.textPrimary)      root.style.setProperty('--color-text-primary', config.textPrimary)
      if (config.textSecondary)    root.style.setProperty('--color-text-secondary', config.textSecondary)
      if (config.textMuted)        root.style.setProperty('--color-text-muted', config.textMuted)
      if (config.textInverse)      root.style.setProperty('--color-text-inverse', config.textInverse)
      if (config.accent)           root.style.setProperty('--color-accent', config.accent)
      if (config.accentHover)      root.style.setProperty('--color-accent-hover', config.accentHover)
      if (config.accentSubtle)     root.style.setProperty('--color-accent-subtle', config.accentSubtle)
      if (config.emphasis)         root.style.setProperty('--color-emphasis', config.emphasis)
      if (config.emphasisHover)    root.style.setProperty('--color-emphasis-hover', config.emphasisHover)
      if (config.success)          root.style.setProperty('--color-status-done', config.success)
      if (config.warning)          root.style.setProperty('--color-status-pending', config.warning)
      if (config.error)            root.style.setProperty('--color-status-failed', config.error)
      if (config.info)             root.style.setProperty('--color-status-running', config.info)

      // AI: 圆角
      if (config.radius) {
        const r = config.radius
        root.style.setProperty('--radius-sm', r === 'sm' ? '4px' : r === 'md' ? '8px'  : r === 'lg' ? '12px' : '16px')
        root.style.setProperty('--radius-md', r === 'sm' ? '6px' : r === 'md' ? '8px'  : r === 'lg' ? '12px' : '16px')
        root.style.setProperty('--radius-lg', r === 'sm' ? '8px' : r === 'md' ? '12px' : r === 'lg' ? '16px' : '20px')
        root.style.setProperty('--radius-xl', r === 'sm' ? '12px': r === 'md' ? '16px' : r === 'lg' ? '20px' : '24px')
      }

      // AI: 侧边栏
      if (config.sidebar) {
        if (config.sidebar.background)    root.style.setProperty('--sidebar-bg', config.sidebar.background)
        if (config.sidebar.textPrimary)   root.style.setProperty('--sidebar-text', config.sidebar.textPrimary)
        if (config.sidebar.textSecondary) root.style.setProperty('--sidebar-text-secondary', config.sidebar.textSecondary)
        if (config.sidebar.border)        root.style.setProperty('--sidebar-border', config.sidebar.border)
        if (config.sidebar.width)         root.style.setProperty('--sidebar-width', `${config.sidebar.width}px`)
        if (config.sidebar.collapsedWidth) root.style.setProperty('--sidebar-collapsed-width', `${config.sidebar.collapsedWidth}px`)
        // AI: 侧边栏独立壁纸 — ::before 渲染，背景色透明度控制覆盖程度
        if (config.sidebar.wallpaper) {
          const sbWallpaper = config.sidebar.wallpaper.startsWith('data:')
            ? `url("${config.sidebar.wallpaper}")`
            : `url(${config.sidebar.wallpaper})`
          root.style.setProperty('--sidebar-wallpaper', sbWallpaper)
          const sbOpacity = typeof config.sidebar.wallpaperOverlay === 'number' ? config.sidebar.wallpaperOverlay : 0.85
          root.style.setProperty('--sidebar-bg-opacity', String(sbOpacity))
        } else {
          root.style.setProperty('--sidebar-wallpaper', 'none')
          root.style.setProperty('--sidebar-bg-opacity', '1')
        }
      }

      // AI: 字体
      if (config.font) {
        if (config.font.family) root.style.setProperty('--font-family', config.font.family)
        if (config.font.size) {
          const s = config.font.size
          root.style.setProperty('--font-size-scale', s === 'sm' ? '0.875' : s === 'md' ? '1' : '1.125')
        }
        if (config.font.lineHeight) {
          const lh = config.font.lineHeight
          root.style.setProperty('--line-height', lh === 'compact' ? '1.25' : lh === 'normal' ? '1.5' : '1.75')
        }
      }

      // AI: 密度
      if (config.density) {
        const d = config.density
        root.style.setProperty('--density-scale',   d === 'compact' ? '0.75' : d === 'normal' ? '1'    : '1.25')
        root.style.setProperty('--density-padding', d === 'compact' ? '0.5rem' : d === 'normal' ? '1rem'  : '1.5rem')
        root.style.setProperty('--density-gap',     d === 'compact' ? '0.5rem' : d === 'normal' ? '0.75rem': '1rem')
      }

      // AI: 主内容区壁纸 — 通过 CSS 变量注入，由 .manta-main-container::before 渲染
      if (config.wallpaper) {
        const wallpaperValue = config.wallpaper.startsWith('data:')
          ? `url("${config.wallpaper}")`
          : `url(${config.wallpaper})`
        root.style.setProperty('--main-wallpaper', wallpaperValue)
        // AI: 背景色透明度（0 = 完全透明看壁纸，1 = 完全不透明），默认 0.85
        const opacity = typeof config.wallpaperOpacity === 'number' ? config.wallpaperOpacity : 0.85
        root.style.setProperty('--main-bg-opacity', String(opacity))
      } else {
        root.style.setProperty('--main-wallpaper', 'none')
        root.style.setProperty('--main-bg-opacity', '1')
      }
    } catch {
      // AI: localStorage 数据损坏时静默忽略，保持默认主题
    }
  }, [])

  return null
}
/* AI end: ThemeInitializer 结束 */
