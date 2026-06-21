/* AI start: Manta 主题选择页 — 独立 Tab，展示所有设计规范主题 */

import { useState, useEffect } from 'react'
import {
  DESIGN_THEMES,
  DesignTheme,
  ThemeConfig,
  applyTheme,
  loadThemeFromStorage,
  getThemeById,
  getThemeConfig,
  saveThemeToStorage,
} from '@/lib/theme-presets'
import { setColorModeClass } from '@/components/ThemeInitializer'

type FilterMode = 'all' | 'light' | 'dark'

export default function ThemesPage() {
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [activeThemeId, setActiveThemeId] = useState<string>('cli-pixel')
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')
  // AI: 自定义微调面板展开状态
  const [showCustomize, setShowCustomize] = useState(false)
  const [customTheme, setCustomTheme] = useState<ThemeConfig | null>(null)

  useEffect(() => {
    const saved = loadThemeFromStorage()
    if (saved) {
      setActiveThemeId(saved.themeId)
      setColorMode(saved.mode)
      setCustomTheme(saved.config)
    } else {
      setColorMode('dark')
      setActiveThemeId('cli-pixel')
    }
    const storedMode = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    if (storedMode) setColorMode(storedMode)
  }, [])

  // AI: 应用主题
  function applyDesignTheme(theme: DesignTheme) {
    const config = getThemeConfig(theme, colorMode)
    applyTheme(config)
    setActiveThemeId(theme.id)
    setCustomTheme(config)
    saveThemeToStorage(theme.id, config, colorMode)
  }

  // AI: 切换颜色模式
  function toggleColorMode(newMode: 'light' | 'dark') {
    setColorMode(newMode)
    setColorModeClass(newMode)
    localStorage.setItem('manta:color-mode', newMode)
    // AI: 重新应用当前主题的对应模式
    const theme = getThemeById(activeThemeId) ?? DESIGN_THEMES[0]
    const config = getThemeConfig(theme, newMode)
    applyTheme(config)
    setCustomTheme(config)
    saveThemeToStorage(activeThemeId, config, newMode)
  }

  // AI: 过滤主题列表
  const filteredThemes = DESIGN_THEMES.filter((t) => {
    if (filterMode === 'all') return true
    if (filterMode === 'light') return t.category !== 'dark-only'
    if (filterMode === 'dark') return t.category !== 'light-only'
    return true
  })

  return (
    <div className="min-h-full" style={{ background: 'var(--color-background)' }}>
      {/* ─── 顶部 Header ─── */}
      <div
        className="sticky top-0 z-10 px-8 py-4 flex items-center justify-between"
        style={{
          background: 'var(--color-background)',
          borderBottom: '1px solid var(--color-border)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.4px',
              margin: 0,
            }}
          >
            主题定制
          </h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', margin: '2px 0 0' }}>
            选择设计规范，切换亮暗模式，打造专属工作台
          </p>
        </div>

        {/* AI: 亮暗模式切换 */}
        <div
          className="flex items-center gap-1 p-1 rounded-lg"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => toggleColorMode('light')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all duration-200"
            style={{
              background: colorMode === 'light' ? 'var(--color-accent)' : 'transparent',
              color: colorMode === 'light' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span>☀</span>
            <span>亮色</span>
          </button>
          <button
            onClick={() => toggleColorMode('dark')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all duration-200"
            style={{
              background: colorMode === 'dark' ? 'var(--color-accent)' : 'transparent',
              color: colorMode === 'dark' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span>☾</span>
            <span>暗色</span>
          </button>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* ─── 当前主题信息栏 ─── */}
        {(() => {
          const activeTheme = getThemeById(activeThemeId)
          if (!activeTheme) return null
          return (
            <div
              className="flex items-center gap-4 p-4 rounded-xl mb-6"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-accent)',
              }}
            >
              {/* AI: 当前主题色板 */}
              <div className="flex items-center gap-1.5">
                {[activeTheme.preview.bg, activeTheme.preview.surface, activeTheme.preview.accent, activeTheme.preview.text].map((c, i) => (
                  <div
                    key={i}
                    className="w-6 h-6 rounded-full"
                    style={{ background: colorMode === 'dark'
                      ? [activeTheme.dark.background, activeTheme.dark.surface, activeTheme.dark.accent, activeTheme.dark.textPrimary][i]
                      : [activeTheme.light.background, activeTheme.light.surface, activeTheme.light.accent, activeTheme.light.textPrimary][i],
                      border: '1px solid var(--color-border)',
                    }}
                  />
                ))}
              </div>
              <div className="flex-1">
                <p style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '14px', margin: 0 }}>
                  当前：{activeTheme.name}
                </p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '12px', margin: '2px 0 0' }}>
                  {activeTheme.description}
                </p>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--color-accent)',
                  border: '1px solid var(--color-accent)',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontWeight: 500,
                }}
              >
                {colorMode === 'dark' ? '暗色模式' : '亮色模式'}
              </span>
            </div>
          )
        })()}

        {/* ─── 过滤 Tabs ─── */}
        <div className="flex items-center gap-1 mb-6">
          {(['all', 'light', 'dark'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className="px-4 py-1.5 rounded-md transition-all duration-150"
              style={{
                background: filterMode === mode ? 'var(--color-accent)' : 'transparent',
                color: filterMode === mode ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                border: `1px solid ${filterMode === mode ? 'var(--color-accent)' : 'var(--color-border)'}`,
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {mode === 'all' ? '全部' : mode === 'light' ? '☀ 亮色' : '☾ 暗色'}
            </button>
          ))}
          <span style={{ color: 'var(--color-text-muted)', fontSize: '12px', marginLeft: '8px' }}>
            {filteredThemes.length} 款主题
          </span>
        </div>

        {/* ─── 主题卡片网格 ─── */}
        <div className="grid grid-cols-3 gap-4 mb-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {filteredThemes.map((theme) => {
            const isActive = theme.id === activeThemeId
            const themeColors = colorMode === 'dark' ? theme.dark : theme.light

            return (
              <div
                key={theme.id}
                className="rounded-xl overflow-hidden cursor-pointer transition-all duration-200"
                style={{
                  border: isActive
                    ? '2px solid var(--color-accent)'
                    : '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  boxShadow: isActive
                    ? `0 0 12px rgba(${hexToRgb(themeColors.accent)}, 0.3)`
                    : 'none',
                }}
                onClick={() => applyDesignTheme(theme)}
              >
                {/* AI: 主题色板预览 */}
                <div className="h-20 relative overflow-hidden" style={{ background: themeColors.background }}>
                  {/* AI: 模拟侧边栏 */}
                  <div
                    className="absolute left-0 top-0 bottom-0"
                    style={{ width: '48px', background: themeColors.surface, borderRight: `1px solid ${themeColors.border}` }}
                  >
                    <div className="flex flex-col items-center gap-2 pt-3">
                      <div className="w-5 h-5 rounded" style={{ background: themeColors.accent }} />
                      {[1,2,3].map(i => (
                        <div key={i} className="w-4 h-1.5 rounded-sm" style={{ background: themeColors.border }} />
                      ))}
                    </div>
                  </div>
                  {/* AI: 模拟内容区 */}
                  <div className="ml-12 pt-3 pr-3 space-y-1.5">
                    <div className="h-2.5 rounded-sm w-3/4" style={{ background: themeColors.textPrimary, opacity: 0.8 }} />
                    <div className="h-1.5 rounded-sm w-full" style={{ background: themeColors.textSecondary, opacity: 0.4 }} />
                    <div className="h-1.5 rounded-sm w-5/6" style={{ background: themeColors.textSecondary, opacity: 0.3 }} />
                    {/* AI: 模拟卡片 */}
                    <div
                      className="mt-2 h-6 rounded"
                      style={{
                        background: themeColors.surface,
                        border: `1px solid ${themeColors.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '6px',
                        gap: '4px',
                      }}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ background: themeColors.accent }} />
                      <div className="h-1 rounded-sm flex-1" style={{ background: themeColors.textMuted, opacity: 0.5 }} />
                    </div>
                  </div>
                </div>

                {/* AI: 主题信息 */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h3
                      style={{
                        color: 'var(--color-text-primary)',
                        fontWeight: 600,
                        fontSize: '14px',
                        margin: 0,
                        letterSpacing: '-0.2px',
                      }}
                    >
                      {theme.name}
                    </h3>

                    <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
                      {/* AI: 打开设计规范原文（新页面） */}
                      <a
                        href={getDesignDocUrl(theme)}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        title={`查看 ${theme.name} 设计规范`}
                        aria-label={`查看 ${theme.name} 设计规范`}
                        style={{
                          color: 'var(--color-text-muted)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-surfaceElevated)',
                          width: '20px',
                          height: '20px',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textDecoration: 'none',
                          fontSize: '11px',
                          lineHeight: 1,
                        }}
                      >
                        ↗
                      </a>

                      {isActive && (
                        <span
                          style={{
                            fontSize: '10px',
                            color: 'var(--color-accent)',
                            background: 'var(--color-accent-subtle)',
                            padding: '2px 6px',
                            borderRadius: '999px',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          当前
                        </span>
                      )}
                    </div>
                  </div>
                  <p
                    style={{
                      color: 'var(--color-text-muted)',
                      fontSize: '12px',
                      margin: 0,
                      lineHeight: 1.5,
                    }}
                  >
                    {theme.description}
                  </p>

                  {/* AI: 色板小圆点 */}
                  <div className="flex items-center gap-1.5 mt-3">
                    {[themeColors.background, themeColors.surface, themeColors.accent, themeColors.textPrimary, themeColors.border].map(
                      (c, i) => (
                        <div
                          key={i}
                          className="w-4 h-4 rounded-full"
                          style={{ background: c, border: '1px solid var(--color-border-subtle)' }}
                          title={c}
                        />
                      )
                    )}
                    <span style={{ color: 'var(--color-text-muted)', fontSize: '10px', marginLeft: '2px' }}>
                      {theme.designFile.replace('-design.md', '')}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* ─── 高级自定义面板 ─── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => setShowCustomize(!showCustomize)}
            className="w-full flex items-center justify-between px-6 py-4 transition-colors"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <div className="flex items-center gap-3">
              <span style={{ fontSize: '16px' }}>✦</span>
              <div className="text-left">
                <p style={{ fontWeight: 600, fontSize: '14px', margin: 0 }}>高级自定义</p>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '12px', margin: 0 }}>
                  在当前主题基础上微调颜色、字体和布局密度
                </p>
              </div>
            </div>
            <span
              style={{
                color: 'var(--color-text-muted)',
                fontSize: '12px',
                transition: 'transform 0.2s',
                transform: showCustomize ? 'rotate(180deg)' : 'none',
              }}
            >
              ▼
            </span>
          </button>

          {showCustomize && customTheme && (
            <div className="px-6 pb-6" style={{ borderTop: '1px solid var(--color-border)' }}>
              <CustomizePanel
                config={customTheme}
                onChange={(newConfig) => {
                  setCustomTheme(newConfig)
                  applyTheme(newConfig)
                  saveThemeToStorage(activeThemeId, newConfig, colorMode)
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* AI start: 自定义面板组件 */
function CustomizePanel({
  config,
  onChange,
}: {
  config: ThemeConfig
  onChange: (config: ThemeConfig) => void
}) {
  function update(key: keyof ThemeConfig, value: string) {
    onChange({ ...config, [key]: value })
  }

  const colorFields: { key: keyof ThemeConfig; label: string }[] = [
    { key: 'background', label: '背景色' },
    { key: 'surface', label: '表面色' },
    { key: 'accent', label: '强调色' },
    { key: 'emphasis', label: '重点色' },
    { key: 'textPrimary', label: '主文字' },
    { key: 'textSecondary', label: '次文字' },
    { key: 'border', label: '边框色' },
    { key: 'success', label: '成功色' },
    { key: 'warning', label: '警告色' },
    { key: 'error', label: '错误色' },
  ]

  return (
    <div className="pt-4">
      {/* 颜色 */}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500, marginBottom: '12px' }}>
        颜色微调
      </p>
      <div className="grid grid-cols-2 gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {colorFields.map(({ key, label }) => (
          <MiniColorPicker
            key={key}
            label={label}
            value={String(config[key] ?? '')}
            onChange={(v) => update(key, v)}
          />
        ))}
      </div>

      {/* 圆角 */}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
        圆角大小
      </p>
      <div className="flex gap-2 mb-6">
        {(['sm', 'md', 'lg', 'xl'] as const).map((r) => (
          <button
            key={r}
            onClick={() => onChange({ ...config, radius: r })}
            className="flex-1 py-2 rounded-md transition-all text-sm"
            style={{
              background: config.radius === r ? 'var(--color-accent)' : 'var(--color-surface)',
              color: config.radius === r ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: `1px solid ${config.radius === r ? 'var(--color-accent)' : 'var(--color-border)'}`,
              cursor: 'pointer',
            }}
          >
            {r === 'sm' ? '小' : r === 'md' ? '中' : r === 'lg' ? '大' : '特大'}
          </button>
        ))}
      </div>

      {/* 密度 */}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
        布局密度
      </p>
      <div className="flex gap-2 mb-6">
        {(['compact', 'normal', 'comfortable'] as const).map((d) => (
          <button
            key={d}
            onClick={() => onChange({ ...config, density: d })}
            className="flex-1 py-2 rounded-md transition-all text-sm"
            style={{
              background: config.density === d ? 'var(--color-accent)' : 'var(--color-surface)',
              color: config.density === d ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: `1px solid ${config.density === d ? 'var(--color-accent)' : 'var(--color-border)'}`,
              cursor: 'pointer',
            }}
          >
            {d === 'compact' ? '紧凑' : d === 'normal' ? '标准' : '宽松'}
          </button>
        ))}
      </div>

      {/* 壁纸 */}
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>
        背景壁纸
      </p>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={(config.wallpaper ?? '').startsWith('data:') ? '[本地图片]' : (config.wallpaper ?? '')}
          onChange={(e) => onChange({ ...config, wallpaper: e.target.value })}
          placeholder="输入图片 URL"
          className="flex-1 px-3 py-2 rounded-md text-sm"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        />
        <label
          className="px-3 py-2 rounded-md text-sm cursor-pointer flex items-center gap-1"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          📁
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = (ev) => {
                const dataUrl = ev.target?.result as string
                if (dataUrl) onChange({ ...config, wallpaper: dataUrl })
              }
              reader.readAsDataURL(file)
              e.target.value = ''
            }}
          />
        </label>
        <button
          onClick={() => onChange({ ...config, wallpaper: undefined })}
          className="px-3 py-2 rounded-md text-sm"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          清除
        </button>
      </div>
    </div>
  )
}
/* AI end: 自定义面板 */

/* AI start: 迷你颜色选择器 */
function MiniColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value.startsWith('#') ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer flex-shrink-0"
        style={{ padding: '1px', border: '1px solid var(--color-border)', background: 'transparent' }}
      />
      <div className="flex-1 min-w-0">
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '11px', margin: 0 }}>{label}</p>
        <p
          style={{
            color: 'var(--color-text-muted)',
            fontSize: '10px',
            fontFamily: 'monospace',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </p>
      </div>
    </div>
  )
}
/* AI end: MiniColorPicker */

/** 十六进制转 RGB 字符串（用于 rgba()） */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '0,0,0'
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
}

// AI: 根据主题生成 getdesign 设计文档链接（新窗口查看）
function getDesignDocUrl(theme: DesignTheme): string {
  const specialSlugMap: Record<string, string> = {
    xai: 'xai',
    mistral: 'mistral.ai',
    cal: 'cal',
    voltagent: 'voltagent',
  }
  const slug = specialSlugMap[theme.id] ?? theme.id
  return `https://getdesign.md/${slug}/design-md`
}

/* AI end: 主题页面 */
