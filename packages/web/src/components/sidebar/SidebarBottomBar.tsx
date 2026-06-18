/* 侧边栏底部用户栏组件 */
import { Settings, Moon, Sun } from 'lucide-react'
import { useState, useEffect } from 'react'

interface SidebarBottomBarProps {
  onSettingsClick: () => void
}

export function SidebarBottomBar({ onSettingsClick }: SidebarBottomBarProps) {
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    if (stored === 'light' || stored === 'dark') {
      setColorMode(stored)
    }
  }, [])

  const toggleColorMode = () => {
    const newMode = colorMode === 'dark' ? 'light' : 'dark'
    setColorMode(newMode)
    localStorage.setItem('manta:color-mode', newMode)
    document.documentElement.classList.toggle('dark', newMode === 'dark')
    document.documentElement.classList.toggle('light', newMode === 'light')
  }

  return (
    <div className="p-3 border-t border-border-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center">
            <span className="text-xs font-bold text-text-inverse">M</span>
          </div>
          <span className="text-sm text-text-primary">Manta User</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleColorMode}
            className="p-1.5 hover:bg-surface-elevated rounded-md transition-colors"
            title="Toggle color mode"
          >
            {colorMode === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button
            onClick={onSettingsClick}
            className="p-1.5 hover:bg-surface-elevated rounded-md transition-colors"
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
