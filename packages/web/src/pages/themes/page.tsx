/* 主题页 — /themes */
import { useState } from 'react'
import { Palette, Check, Sun, Moon, Monitor } from 'lucide-react'

interface Theme {
  id: string
  name: string
  description: string
  preview: {
    background: string
    surface: string
    accent: string
    text: string
  }
}

export default function ThemesPage() {
  const [selectedTheme, setSelectedTheme] = useState('cli-pixel')
  const [colorMode, setColorMode] = useState<'light' | 'dark' | 'system'>('dark')

  const themes: Theme[] = [
    {
      id: 'cli-pixel',
      name: 'CLI Pixel',
      description: 'Dark terminal-inspired theme',
      preview: {
        background: '#0a0a0a',
        surface: '#1a1a1a',
        accent: '#00ff00',
        text: '#ffffff'
      }
    },
    {
      id: 'ocean-breeze',
      name: 'Ocean Breeze',
      description: 'Calming blue theme',
      preview: {
        background: '#f0f9ff',
        surface: '#ffffff',
        accent: '#0ea5e9',
        text: '#0c4a6e'
      }
    },
    {
      id: 'sunset-glow',
      name: 'Sunset Glow',
      description: 'Warm orange theme',
      preview: {
        background: '#fff7ed',
        surface: '#ffffff',
        accent: '#f97316',
        text: '#7c2d12'
      }
    },
    {
      id: 'forest-green',
      name: 'Forest Green',
      description: 'Natural green theme',
      preview: {
        background: '#f0fdf4',
        surface: '#ffffff',
        accent: '#22c55e',
        text: '#14532d'
      }
    }
  ]

  const handleApplyTheme = (themeId: string) => {
    setSelectedTheme(themeId)
    // 应用主题到文档
    const theme = themes.find(t => t.id === themeId)
    if (theme) {
      document.documentElement.style.setProperty('--color-background', theme.preview.background)
      document.documentElement.style.setProperty('--color-surface', theme.preview.surface)
      document.documentElement.style.setProperty('--color-accent', theme.preview.accent)
      document.documentElement.style.setProperty('--color-text-primary', theme.preview.text)
    }
  }

  const handleColorModeChange = (mode: 'light' | 'dark' | 'system') => {
    setColorMode(mode)
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.classList.toggle('light', mode === 'light')
  }

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto">
        {/* 顶部标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Themes</h1>
          <p className="text-text-secondary mt-1">Customize your interface appearance</p>
        </div>

        {/* 颜色模式选择 */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3">Color Mode</h2>
          <div className="flex gap-3">
            {[
              { id: 'light', label: 'Light', icon: <Sun size={18} /> },
              { id: 'dark', label: 'Dark', icon: <Moon size={18} /> },
              { id: 'system', label: 'System', icon: <Monitor size={18} /> }
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => handleColorModeChange(mode.id as 'light' | 'dark' | 'system')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  colorMode === mode.id
                    ? 'bg-accent text-text-inverse'
                    : 'bg-surface-elevated text-text-secondary hover:bg-surface'
                }`}
              >
                {mode.icon}
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 主题选择 */}
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Theme</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {themes.map((theme) => (
              <div
                key={theme.id}
                onClick={() => handleApplyTheme(theme.id)}
                className={`relative cursor-pointer rounded-lg p-4 border-2 transition-all ${
                  selectedTheme === theme.id
                    ? 'border-accent shadow-lg'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                {/* 选中标记 */}
                {selectedTheme === theme.id && (
                  <div className="absolute top-3 right-3">
                    <Check size={20} className="text-accent" />
                  </div>
                )}

                {/* 预览 */}
                <div
                  className="h-32 rounded-lg mb-3 p-3"
                  style={{ backgroundColor: theme.preview.background }}
                >
                  <div
                    className="h-6 rounded mb-2"
                    style={{ backgroundColor: theme.preview.surface }}
                  ></div>
                  <div
                    className="h-4 w-2/3 rounded mb-2"
                    style={{ backgroundColor: theme.preview.accent }}
                  ></div>
                  <div
                    className="h-3 w-1/2 rounded"
                    style={{ backgroundColor: theme.preview.text }}
                  ></div>
                </div>

                {/* 信息 */}
                <h3 className="font-semibold text-text-primary">{theme.name}</h3>
                <p className="text-sm text-text-secondary">{theme.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 预览区域 */}
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3">Preview</h2>
          <div className="bg-surface-elevated rounded-lg p-6 border border-border">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-accent rounded-lg flex items-center justify-center">
                <Palette size={24} className="text-text-inverse" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Theme Preview</h3>
                <p className="text-text-secondary">See how your theme looks</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-surface p-4 rounded-lg">
                <p className="text-text-primary font-medium">Surface</p>
                <p className="text-text-secondary text-sm">Background color</p>
              </div>
              <div className="bg-accent p-4 rounded-lg">
                <p className="text-text-inverse font-medium">Accent</p>
                <p className="text-text-inverse/80 text-sm">Primary color</p>
              </div>
              <div className="bg-background p-4 rounded-lg border border-border">
                <p className="text-text-primary font-medium">Background</p>
                <p className="text-text-secondary text-sm">Base color</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
