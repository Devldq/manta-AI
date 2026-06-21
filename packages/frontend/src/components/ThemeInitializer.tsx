/* AI start: ThemeInitializer — 全局主题初始化 Client Component
 * 在根布局挂载，从 localStorage 读取并通过 CSS 变量应用主题配置
 * 支持 light / dark / system 三种模式，system 跟随系统偏好
 */

import { useEffect } from 'react'
import { applyTheme, loadThemeFromStorage, getThemeById, getThemeConfig, DESIGN_THEMES } from '@/lib/theme-presets'

export function ThemeInitializer() {
  useEffect(() => {
    // AI: 应用存储的主题，或使用默认 CLI Pixel 主题
    function initTheme() {
      const saved = loadThemeFromStorage()

      if (saved) {
        // AI: 应用已保存的主题配置
        applyTheme(saved.config)
        setColorModeClass(saved.mode)
      } else {
        // AI: 首次加载 — 默认使用 CLI Pixel 暗色主题
        const defaultTheme = getThemeById('cli-pixel') ?? DESIGN_THEMES[0]
        const defaultMode: 'dark' = 'dark'
        const config = getThemeConfig(defaultTheme, defaultMode)
        applyTheme(config)
        setColorModeClass(defaultMode)
      }
    }

    initTheme()

    // AI: 监听系统颜色模式变化（当存储模式为 system 时响应）
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    function handleSystemModeChange() {
      const storedMode = localStorage.getItem('manta:color-mode')
      if (storedMode === 'system' || !storedMode) {
        // AI: 重新加载当前主题，用新的系统模式
        const saved = loadThemeFromStorage()
        const newMode = mediaQuery.matches ? 'dark' : 'light'
        if (saved) {
          const theme = getThemeById(saved.themeId)
          if (theme) {
            const config = getThemeConfig(theme, newMode)
            applyTheme(config)
          } else {
            applyTheme(saved.config)
          }
        }
        setColorModeClass(newMode)
      }
    }

    mediaQuery.addEventListener('change', handleSystemModeChange)
    return () => mediaQuery.removeEventListener('change', handleSystemModeChange)
  }, [])

  return null
}

/** 在 <html> 上设置 .dark / .light 类 */
function setColorModeClass(mode: 'light' | 'dark') {
  const html = document.documentElement
  if (mode === 'dark') {
    html.classList.add('dark')
    html.classList.remove('light')
  } else {
    html.classList.add('light')
    html.classList.remove('dark')
  }
}

/** 读取系统颜色模式 */
function getSystemColorMode(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export { setColorModeClass, getSystemColorMode }
/* AI end: ThemeInitializer 结束 */
