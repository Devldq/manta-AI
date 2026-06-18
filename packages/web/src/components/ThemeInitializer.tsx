/* Manta 主题初始化组件 */
import { useEffect } from 'react'

/** 获取系统深浅色模式 */
export function getSystemColorMode(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 设置深浅色 class */
export function setColorModeClass(mode: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  document.documentElement.classList.toggle('light', mode === 'light')
}

/** 主题初始化 */
export function ThemeInitializer() {
  useEffect(() => {
    const mode = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    const colorMode = mode || getSystemColorMode()
    setColorModeClass(colorMode)
  }, [])

  return null
}
