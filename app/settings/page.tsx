/*  start: Manta 设置页 — Runner 探测状态 + Webhook Channel 配置 + 插件管理 + 主题配置 */
'use client'

import { useState, useEffect, useRef } from 'react'

interface RunnerStatus {
  id: string
  available: boolean
  reason?: string
  version?: string
}

interface WebhookConfig {
  url: string
  type: 'feishu' | 'slack' | 'dingtalk' | 'discord' | 'generic'
  enabled: boolean
}

/* AI start: 插件 manifest 类型（对应 plugin.yaml） */
interface PluginManifest {
  id: string
  name: string
  runnerId: string
  description?: string
  agentFormat: string
  agentsDirs?: string[]
  openclawConfigFile?: string
  isNpm?: boolean
  disabled?: boolean
}
/* AI end: 插件 manifest 类型结束 */

/* AI start: 主题配置类型 */
interface SidebarConfig {
  background: string
  textPrimary: string
  textSecondary: string
  border: string
  width: number
  collapsedWidth: number
  // AI: 侧边栏独立壁纸（可选，支持 URL 和 base64 DataURL）
  wallpaper?: string
  wallpaperOverlay?: number
}

interface FontConfig {
  family: string
  size: 'sm' | 'md' | 'lg'
  lineHeight: 'compact' | 'normal' | 'relaxed'
}

interface ThemeConfig {
  wallpaper?: string
  // AI: 背景色透明度（0 = 完全透明看壁纸，1 = 完全不透明看背景色），默认 0.85
  wallpaperOpacity?: number
  background: string
  surface: string
  surfaceElevated: string
  border: string
  borderSubtle: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  textInverse: string
  accent: string
  accentHover: string
  accentSubtle: string
  emphasis: string
  emphasisHover: string
  success: string
  warning: string
  error: string
  info: string
  radius: 'sm' | 'md' | 'lg' | 'xl'
  sidebar: SidebarConfig
  font: FontConfig
  density: 'compact' | 'normal' | 'comfortable'
}

const FONT_OPTIONS = [
  { label: '系统默认', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: '思源黑体', value: '"Noto Sans SC", "Source Han Sans", sans-serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", sans-serif' },
  { label: '等宽字体', value: '"JetBrains Mono", "Fira Code", monospace' },
]

const PRESET_THEMES = [
  { name: 'WorkBuddy 默认', id: 'default' },
  { name: '深色模式', id: 'dark' },
  { name: '海洋蓝', id: 'ocean' },
  { name: '森林绿', id: 'forest' },
  { name: '紫罗兰', id: 'violet' },
  { name: '暖橙色', id: 'warm' },
  { name: '樱花粉', id: 'sakura' },
  { name: '高级黑', id: 'luxury' },
]

const DEFAULT_SIDEBAR: SidebarConfig = {
  background: '#f8f8f8',
  textPrimary: '#0a0a0a',
  textSecondary: '#525252',
  border: '#e5e5e5',
  width: 240,
  collapsedWidth: 64,
}

const DEFAULT_FONT: FontConfig = {
  family: 'system-ui, -apple-system, sans-serif',
  size: 'md',
  lineHeight: 'normal',
}

const THEME_PRESETS: Record<string, ThemeConfig> = {
  default: {
    background: '#ffffff',
    surface: '#f8f8f8',
    surfaceElevated: '#ffffff',
    border: '#e5e5e5',
    borderSubtle: '#f0f0f0',
    textPrimary: '#0a0a0a',
    textSecondary: '#525252',
    textMuted: '#a3a3a3',
    textInverse: '#ffffff',
    accent: '#0a0a0a',
    accentHover: '#1a1a1a',
    accentSubtle: '#f5f5f5',
    emphasis: '#3b82f6',
    emphasisHover: '#2563eb',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    radius: 'md',
    sidebar: DEFAULT_SIDEBAR,
    font: DEFAULT_FONT,
    density: 'normal',
  },
  dark: {
    background: '#0f1117',
    surface: '#1e2130',
    surfaceElevated: '#252a3d',
    border: '#2d3148',
    borderSubtle: '#1e2130',
    textPrimary: '#ffffff',
    textSecondary: '#a0aec0',
    textMuted: '#4a5568',
    textInverse: '#0a0a0a',
    accent: '#3b82f6',
    accentHover: '#2563eb',
    accentSubtle: '#1e3a5f',
    emphasis: '#60a5fa',
    emphasisHover: '#3b82f6',
    success: '#22c55e',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
    radius: 'md',
    sidebar: {
      background: '#1a1d27',
      textPrimary: '#ffffff',
      textSecondary: '#a0aec0',
      border: '#2d3148',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'normal',
  },
  ocean: {
    background: '#f0f9ff',
    surface: '#e0f2fe',
    surfaceElevated: '#ffffff',
    border: '#bae6fd',
    borderSubtle: '#e0f2fe',
    textPrimary: '#0c4a6e',
    textSecondary: '#0369a1',
    textMuted: '#64748b',
    textInverse: '#ffffff',
    accent: '#0284c7',
    accentHover: '#0369a1',
    accentSubtle: '#e0f2fe',
    emphasis: '#0ea5e9',
    emphasisHover: '#0284c7',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#0ea5e9',
    radius: 'lg',
    sidebar: {
      background: '#e0f2fe',
      textPrimary: '#0c4a6e',
      textSecondary: '#0369a1',
      border: '#bae6fd',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'normal',
  },
  forest: {
    background: '#f0fdf4',
    surface: '#dcfce7',
    surfaceElevated: '#ffffff',
    border: '#bbf7d0',
    borderSubtle: '#dcfce7',
    textPrimary: '#14532d',
    textSecondary: '#166534',
    textMuted: '#64748b',
    textInverse: '#ffffff',
    accent: '#16a34a',
    accentHover: '#15803d',
    accentSubtle: '#dcfce7',
    emphasis: '#22c55e',
    emphasisHover: '#16a34a',
    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    info: '#3b82f6',
    radius: 'md',
    sidebar: {
      background: '#dcfce7',
      textPrimary: '#14532d',
      textSecondary: '#166534',
      border: '#bbf7d0',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'normal',
  },
  violet: {
    background: '#faf5ff',
    surface: '#f3e8ff',
    surfaceElevated: '#ffffff',
    border: '#e9d5ff',
    borderSubtle: '#f3e8ff',
    textPrimary: '#581c87',
    textSecondary: '#7c3aed',
    textMuted: '#8b5cf6',
    textInverse: '#ffffff',
    accent: '#8b5cf6',
    accentHover: '#7c3aed',
    accentSubtle: '#f3e8ff',
    emphasis: '#a855f7',
    emphasisHover: '#8b5cf6',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#8b5cf6',
    radius: 'xl',
    sidebar: {
      background: '#f3e8ff',
      textPrimary: '#581c87',
      textSecondary: '#7c3aed',
      border: '#e9d5ff',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'normal',
  },
  warm: {
    background: '#fff7ed',
    surface: '#ffedd5',
    surfaceElevated: '#ffffff',
    border: '#fed7aa',
    borderSubtle: '#ffedd5',
    textPrimary: '#7c2d12',
    textSecondary: '#c2410c',
    textMuted: '#9a3412',
    textInverse: '#ffffff',
    accent: '#ea580c',
    accentHover: '#c2410c',
    accentSubtle: '#ffedd5',
    emphasis: '#f97316',
    emphasisHover: '#ea580c',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    radius: 'lg',
    sidebar: {
      background: '#ffedd5',
      textPrimary: '#7c2d12',
      textSecondary: '#c2410c',
      border: '#fed7aa',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'normal',
  },
  sakura: {
    background: '#fdf2f8',
    surface: '#fce7f3',
    surfaceElevated: '#ffffff',
    border: '#fbcfe8',
    borderSubtle: '#fce7f3',
    textPrimary: '#831843',
    textSecondary: '#be185d',
    textMuted: '#9d174d',
    textInverse: '#ffffff',
    accent: '#ec4899',
    accentHover: '#db2777',
    accentSubtle: '#fce7f3',
    emphasis: '#f472b6',
    emphasisHover: '#ec4899',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    radius: 'xl',
    sidebar: {
      background: '#fce7f3',
      textPrimary: '#831843',
      textSecondary: '#be185d',
      border: '#fbcfe8',
      width: 240,
      collapsedWidth: 64,
    },
    font: DEFAULT_FONT,
    density: 'comfortable',
  },
  luxury: {
    background: '#0a0a0a',
    surface: '#171717',
    surfaceElevated: '#262626',
    border: '#404040',
    borderSubtle: '#262626',
    textPrimary: '#fafafa',
    textSecondary: '#a3a3a3',
    textMuted: '#525252',
    textInverse: '#0a0a0a',
    accent: '#eab308',
    accentHover: '#ca8a04',
    accentSubtle: '#3f3f00',
    emphasis: '#fbbf24',
    emphasisHover: '#eab308',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
    radius: 'sm',
    sidebar: {
      background: '#0a0a0a',
      textPrimary: '#fafafa',
      textSecondary: '#a3a3a3',
      border: '#404040',
      width: 200,
      collapsedWidth: 56,
    },
    font: { ...DEFAULT_FONT, family: 'Inter, sans-serif' },
    density: 'compact',
  },
}
/* AI end: 主题配置类型 */

export default function SettingsPage() {
  const [runners, setRunners] = useState<RunnerStatus[]>([])
  const [runnerLoading, setRunnerLoading] = useState(false)
  const [webhook, setWebhook] = useState<WebhookConfig>({
    url: '',
    type: 'feishu',
    enabled: false,
  })
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookSaved, setWebhookSaved] = useState(false)
  // AI: 插件列表状态
  const [plugins, setPlugins] = useState<PluginManifest[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(false)
  // AI: 安装表单状态
  const [installPkg, setInstallPkg] = useState('')
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'success' | 'error'>('idle')
  const [installMsg, setInstallMsg] = useState('')
  // AI: 运行环境检测 — true 表示在 Electron 中，可用原生文件夹对话框
  const [isElectron, setIsElectron] = useState(false)
  // AI start: 主题配置状态
  const [theme, setTheme] = useState<ThemeConfig>(THEME_PRESETS.default)
  const [activeThemeId, setActiveThemeId] = useState<string>('default')
  const [customWallpaper, setCustomWallpaper] = useState<string>('')
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null)
  // AI end: 主题配置状态

  useEffect(() => {
    const api = (window as Window & { electronAPI?: { selectDirectory?: unknown } }).electronAPI
    setIsElectron(typeof api?.selectDirectory === 'function')
    // AI start: 从 localStorage 加载主题配置
    const savedTheme = localStorage.getItem('manta:theme')
    if (savedTheme) {
      try {
        const parsed = JSON.parse(savedTheme)
        setTheme(parsed.config || THEME_PRESETS.default)
        setActiveThemeId(parsed.presetId || 'custom')
        setCustomWallpaper(parsed.config?.wallpaper || '')
        applyTheme(parsed.config || THEME_PRESETS.default)
      } catch {}
    }
    // AI end: 加载主题配置
  }, [])

  // AI start: 应用主题到 CSS 变量
  function applyTheme(config: ThemeConfig) {
    const root = document.documentElement
    // 基础颜色
    root.style.setProperty('--color-background', config.background)
    root.style.setProperty('--color-surface', config.surface)
    root.style.setProperty('--color-surface-elevated', config.surfaceElevated)
    root.style.setProperty('--color-border', config.border)
    root.style.setProperty('--color-border-subtle', config.borderSubtle)
    root.style.setProperty('--color-text-primary', config.textPrimary)
    root.style.setProperty('--color-text-secondary', config.textSecondary)
    root.style.setProperty('--color-text-muted', config.textMuted)
    root.style.setProperty('--color-text-inverse', config.textInverse)
    root.style.setProperty('--color-accent', config.accent)
    root.style.setProperty('--color-accent-hover', config.accentHover)
    root.style.setProperty('--color-accent-subtle', config.accentSubtle)
    // 新增：重点色和状态色
    root.style.setProperty('--color-emphasis', config.emphasis)
    root.style.setProperty('--color-emphasis-hover', config.emphasisHover)
    root.style.setProperty('--color-status-done', config.success)
    root.style.setProperty('--color-status-pending', config.warning)
    root.style.setProperty('--color-status-failed', config.error)
    root.style.setProperty('--color-status-running', config.info)
    // 圆角
    root.style.setProperty('--radius-sm', config.radius === 'sm' ? '4px' : config.radius === 'md' ? '8px' : config.radius === 'lg' ? '12px' : '16px')
    root.style.setProperty('--radius-md', config.radius === 'sm' ? '6px' : config.radius === 'md' ? '8px' : config.radius === 'lg' ? '12px' : '16px')
    root.style.setProperty('--radius-lg', config.radius === 'sm' ? '8px' : config.radius === 'md' ? '12px' : config.radius === 'lg' ? '16px' : '20px')
    root.style.setProperty('--radius-xl', config.radius === 'sm' ? '12px' : config.radius === 'md' ? '16px' : config.radius === 'lg' ? '20px' : '24px')
    // 侧边栏配置
    root.style.setProperty('--sidebar-bg', config.sidebar.background)
    root.style.setProperty('--sidebar-text', config.sidebar.textPrimary)
    root.style.setProperty('--sidebar-text-secondary', config.sidebar.textSecondary)
    root.style.setProperty('--sidebar-border', config.sidebar.border)
    root.style.setProperty('--sidebar-width', `${config.sidebar.width}px`)
    root.style.setProperty('--sidebar-collapsed-width', `${config.sidebar.collapsedWidth}px`)
    // AI: 侧边栏独立壁纸
    if (config.sidebar.wallpaper) {
      const sbWallpaper = config.sidebar.wallpaper.startsWith('data:')
        ? `url("${config.sidebar.wallpaper}")`
        : `url(${config.sidebar.wallpaper})`
      root.style.setProperty('--sidebar-wallpaper', sbWallpaper)
      // AI: 背景色透明度（0 = 完全透明看壁纸，1 = 完全不透明），默认 0.85
      root.style.setProperty('--sidebar-bg-opacity', String(config.sidebar.wallpaperOverlay ?? 0.85))
    } else {
      root.style.setProperty('--sidebar-wallpaper', 'none')
      root.style.setProperty('--sidebar-bg-opacity', '1')
    }
    // 字体配置
    root.style.setProperty('--font-family', config.font.family)
    root.style.setProperty('--font-size-scale', config.font.size === 'sm' ? '0.875' : config.font.size === 'md' ? '1' : '1.125')
    root.style.setProperty('--line-height', config.font.lineHeight === 'compact' ? '1.25' : config.font.lineHeight === 'normal' ? '1.5' : '1.75')
    // 密度配置
    root.style.setProperty('--density-scale', config.density === 'compact' ? '0.75' : config.density === 'normal' ? '1' : '1.25')
    root.style.setProperty('--density-padding', config.density === 'compact' ? '0.5rem' : config.density === 'normal' ? '1rem' : '1.5rem')
    root.style.setProperty('--density-gap', config.density === 'compact' ? '0.5rem' : config.density === 'normal' ? '0.75rem' : '1rem')
    // AI: 应用主内容区壁纸（通过 CSS 变量，由 ::before 伪元素渲染，无独立 div）
    if (config.wallpaper) {
      const wallpaperValue = config.wallpaper.startsWith('data:')
        ? `url("${config.wallpaper}")`
        : `url(${config.wallpaper})`
      root.style.setProperty('--main-wallpaper', wallpaperValue)
      // AI: 背景色透明度（0 = 完全透明看壁纸，1 = 完全不透明），默认 0.85
      root.style.setProperty('--main-bg-opacity', String(config.wallpaperOpacity ?? 0.85))
    } else {
      root.style.setProperty('--main-wallpaper', 'none')
      root.style.setProperty('--main-bg-opacity', '1')
    }
  }

  function saveTheme() {
    const themeToSave = { ...theme }
    if (customWallpaper) {
      themeToSave.wallpaper = customWallpaper
    }
    localStorage.setItem('manta:theme', JSON.stringify({
      presetId: activeThemeId,
      config: themeToSave,
    }))
    applyTheme(themeToSave)
  }

  function loadPresetTheme(presetId: string) {
    const preset = THEME_PRESETS[presetId]
    if (preset) {
      setTheme(preset)
      setActiveThemeId(presetId)
      setCustomWallpaper('')
      applyTheme(preset)
    }
  }

  function updateThemeColor(key: keyof ThemeConfig, value: string) {
    const newTheme = { ...theme, [key]: value }
    setTheme(newTheme)
    setActiveThemeId('custom')
    applyTheme(newTheme)
  }
  // AI end: 应用主题

  async function probeRunners() {
    setRunnerLoading(true)
    try {
      const res = await fetch('/api/runners/probe')
      const data = await res.json()
      setRunners(data.runners ?? [])
    } catch {
      console.error('Runner probe 失败')
    } finally {
      setRunnerLoading(false)
    }
  }

  // AI: 加载插件列表
  async function loadPlugins() {
    setPluginsLoading(true)
    try {
      const res = await fetch('/api/plugins')
      const data = await res.json()
      setPlugins(data.plugins ?? [])
    } catch {
      console.error('插件列表加载失败')
    } finally {
      setPluginsLoading(false)
    }
  }

  useEffect(() => {
    probeRunners()
    loadPlugins()
    // AI: 从 localStorage 读取 Webhook 配置（MVP 简单存法）
    const saved = localStorage.getItem('manta:webhook')
    if (saved) {
      try {
        setWebhook(JSON.parse(saved))
      } catch {}
    }
  }, [])

  // AI: 安装插件（从本地目录复制）
  async function installPlugin() {
    const sourcePath = installPkg.trim()
    if (!sourcePath) return
    setInstallState('installing')
    setInstallMsg('')
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath }),
      })
      const data = await res.json()
      if (data.success) {
        setInstallState('success')
        setInstallMsg(`✓ 已安装 ${data.pluginName ?? sourcePath}`)
        setInstallPkg('')
        await loadPlugins()
      } else {
        setInstallState('error')
        setInstallMsg(data.error ?? '安装失败')
      }
    } catch (err) {
      setInstallState('error')
      setInstallMsg(String(err))
    }
  }

  // AI: 选择文件夹 — Electron 用原生对话框，浏览器用 <input type="file" webkitdirectory>
  async function browseDirectory() {
    if (isElectron) {
      // AI: Electron 环境：调用原生文件夹选择对话框
      const api = (window as unknown as { electronAPI: { selectDirectory: () => Promise<string | null> } }).electronAPI
      const selected = await api.selectDirectory()
      if (selected) {
        setInstallPkg(selected)
        if (installState !== 'idle') setInstallState('idle')
      }
    } else {
      // AI: 浏览器环境：用隐藏的 <input type="file" webkitdirectory> 触发文件夹选择
      const input = document.createElement('input')
      input.type = 'file'
      // AI: webkitdirectory 让用户选择整个文件夹
      input.setAttribute('webkitdirectory', '')
      input.onchange = () => {
        const files = input.files
        if (files && files.length > 0) {
          // AI: 取第一个文件的路径，去掉文件名得到目录路径
          const firstFile = files[0] as File & { path?: string }
          // AI: Electron webview 中 file.path 是绝对路径；纯浏览器中不可用
          if (firstFile.path) {
            const dirPath = firstFile.path.replace(/[\\/][^\\/]+$/, '')
            setInstallPkg(dirPath)
            if (installState !== 'idle') setInstallState('idle')
          }
        }
      }
      input.click()
    }
  }

  // AI: 卸载插件
  async function uninstallPlugin(pluginId: string) {
    try {
      const res = await fetch('/api/plugins/install', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId }),
      })
      const data = await res.json()
      if (data.success) {
        await loadPlugins()
      } else {
        alert(`卸载失败: ${data.error}`)
      }
    } catch (err) {
      alert(`卸载失败: ${err}`)
    }
  }

  function saveWebhook() {
    setWebhookSaving(true)
    localStorage.setItem('manta:webhook', JSON.stringify(webhook))
    setTimeout(() => {
      setWebhookSaving(false)
      setWebhookSaved(true)
      setTimeout(() => setWebhookSaved(false), 2000)
    }, 300)
  }

  // AI: 目录项定义
  const TOC = [
    { id: 'section-theme', label: '主题配置' },
    { id: 'section-runner', label: 'Runner 状态' },
    { id: 'section-webhook', label: 'Webhook 通知' },
    { id: 'section-plugins', label: '插件管理' },
    { id: 'section-sysinfo', label: '系统信息' },
  ]

  return (
    <div className="flex min-h-full">
      {/* AI start: 左侧目录导航 */}
      <nav className="w-44 flex-shrink-0 sticky top-0 self-start pt-8 pl-6 pr-4 hidden md:block">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">目录</p>
        <ul className="space-y-1">
          {TOC.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className="block text-sm text-text-muted hover:text-text-primary transition-colors py-1 rounded"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {/* AI end: 左侧目录导航结束 */}

      <div className="flex-1 p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">系统设置</h1>
        <p className="mt-1 text-sm text-text-muted">主题配置 · Runner 状态探测 · Channel 配置 · 插件管理 · 系统信息</p>
      </div>

      {/* AI start: 主题配置 */}
      <section id="section-theme" className="mb-10 scroll-mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary">🎨 主题配置</h2>
          <button
            onClick={saveTheme}
            className="text-xs px-3 py-1.5 bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors"
          >
            保存主题
          </button>
        </div>

        {/* 预设主题选择 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">预设主题</p>
          <div className="grid grid-cols-3 gap-2">
            {PRESET_THEMES.map((preset) => (
              <button
                key={preset.id}
                onClick={() => loadPresetTheme(preset.id)}
                className={`px-3 py-2 text-xs rounded-md border transition-all ${
                  activeThemeId === preset.id
                    ? 'bg-accent text-text-inverse border-accent'
                    : 'bg-surface text-text-secondary border-border hover:border-accent'
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* 背景壁纸 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">背景壁纸</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customWallpaper.startsWith('data:') ? '' : customWallpaper}
              onChange={(e) => {
                setCustomWallpaper(e.target.value)
                updateThemeColor('wallpaper', e.target.value)
              }}
              placeholder="输入图片 URL"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            {/* AI: 本地文件选择按钮（隐藏 input file，点击触发） */}
            <label
              className="px-3 py-2 text-xs border border-border rounded-md text-text-secondary hover:bg-surface cursor-pointer flex items-center gap-1 flex-shrink-0"
              title="选择本地图片"
            >
              <span>📁 本地</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  // AI: 读取本地图片为 base64 DataURL，应用并持久化
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string
                    if (dataUrl) {
                      setCustomWallpaper(dataUrl)
                      // AI: 同时更新 theme 对象并写入 localStorage
                      const newTheme = { ...theme, wallpaper: dataUrl }
                      setTheme(newTheme)
                      setActiveThemeId('custom')
                      applyTheme(newTheme)
                      localStorage.setItem('manta:theme', JSON.stringify({
                        presetId: 'custom',
                        config: newTheme,
                      }))
                    }
                  }
                  reader.readAsDataURL(file)
                  // AI: 清空 input，允许重复选同一文件
                  e.target.value = ''
                }}
              />
            </label>
            <button
              onClick={() => {
                setCustomWallpaper('')
                updateThemeColor('wallpaper', '')
              }}
              className="px-3 py-2 text-xs border border-border rounded-md text-text-secondary hover:bg-surface flex-shrink-0"
            >
              清除
            </button>
          </div>
          {/* AI: 已选本地文件时显示文件名提示 */}
          {customWallpaper.startsWith('data:') && (
            <p className="mt-1 text-xs text-text-muted">已加载本地图片</p>
          )}
          {customWallpaper && (
            <div className="mt-2 p-2 bg-surface rounded-md">
              <img
                src={customWallpaper}
                alt="壁纸预览"
                className="w-full h-24 object-cover rounded"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                }}
              />
            </div>
          )}
          {/* AI: 背景色透明度滑块 — 仅有壁纸时显示，控制壁纸透出程度 */}
          {customWallpaper && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-text-secondary">背景色透明度</span>
                <span className="text-xs text-text-muted font-mono">
                  {Math.round((theme.wallpaperOpacity ?? 0.85) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={Math.round((theme.wallpaperOpacity ?? 0.85) * 100)}
                onChange={(e) => {
                  const val = parseInt(e.target.value) / 100
                  // AI: wallpaperOpacity 是 number，单独处理
                  const newTheme = { ...theme, wallpaperOpacity: val }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-xs text-text-muted mt-0.5">
                <span>完全透明（看壁纸）</span>
                <span>完全不透明</span>
              </div>
            </div>
          )}
        </div>

        {/* 颜色配置 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">颜色配置</p>
          <div className="grid grid-cols-2 gap-4">
            <ColorPicker
              label="背景色"
              value={theme.background}
              onChange={(v) => updateThemeColor('background', v)}
            />
            <ColorPicker
              label="表面色"
              value={theme.surface}
              onChange={(v) => updateThemeColor('surface', v)}
            />
            <ColorPicker
              label="主题色"
              value={theme.accent}
              onChange={(v) => updateThemeColor('accent', v)}
            />
            <ColorPicker
              label="重点色"
              value={theme.emphasis}
              onChange={(v) => updateThemeColor('emphasis', v)}
            />
            <ColorPicker
              label="主文字"
              value={theme.textPrimary}
              onChange={(v) => updateThemeColor('textPrimary', v)}
            />
            <ColorPicker
              label="次文字"
              value={theme.textSecondary}
              onChange={(v) => updateThemeColor('textSecondary', v)}
            />
            <ColorPicker
              label="成功色"
              value={theme.success}
              onChange={(v) => updateThemeColor('success', v)}
            />
            <ColorPicker
              label="警告色"
              value={theme.warning}
              onChange={(v) => updateThemeColor('warning', v)}
            />
          </div>
        </div>

        {/* AI start: 侧边栏配置 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">侧边栏配置</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <ColorPicker
              label="侧边栏背景"
              value={theme.sidebar.background}
              onChange={(v) => {
                const newTheme = { ...theme, sidebar: { ...theme.sidebar, background: v } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
            />
            <ColorPicker
              label="侧边栏文字"
              value={theme.sidebar.textPrimary}
              onChange={(v) => {
                const newTheme = { ...theme, sidebar: { ...theme.sidebar, textPrimary: v } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">侧边栏宽度</label>
              <input
                type="range"
                min="180"
                max="300"
                value={theme.sidebar.width}
                onChange={(e) => {
                  const newTheme = { ...theme, sidebar: { ...theme.sidebar, width: parseInt(e.target.value) } }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                className="w-full"
              />
              <span className="text-xs text-text-muted">{theme.sidebar.width}px</span>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">折叠宽度</label>
              <input
                type="range"
                min="48"
                max="80"
                value={theme.sidebar.collapsedWidth}
                onChange={(e) => {
                  const newTheme = { ...theme, sidebar: { ...theme.sidebar, collapsedWidth: parseInt(e.target.value) } }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                className="w-full"
              />
              <span className="text-xs text-text-muted">{theme.sidebar.collapsedWidth}px</span>
            </div>
          </div>

          {/* AI: 侧边栏独立壁纸配置 */}
          <div className="border-t border-border-subtle pt-3">
            <p className="text-xs text-text-muted mb-2">侧边栏壁纸（可与全局壁纸不同）</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={(theme.sidebar.wallpaper ?? '').startsWith('data:') ? '' : (theme.sidebar.wallpaper ?? '')}
                onChange={(e) => {
                  const newTheme = { ...theme, sidebar: { ...theme.sidebar, wallpaper: e.target.value } }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                placeholder="输入图片 URL"
                className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
              {/* AI: 本地文件选择 */}
              <label
                className="px-3 py-2 text-xs border border-border rounded-md text-text-secondary hover:bg-surface cursor-pointer flex items-center gap-1 flex-shrink-0"
                title="选择本地图片"
              >
                <span>📁 本地</span>
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
                      if (dataUrl) {
                        const newTheme = { ...theme, sidebar: { ...theme.sidebar, wallpaper: dataUrl } }
                        setTheme(newTheme)
                        setActiveThemeId('custom')
                        applyTheme(newTheme)
                        localStorage.setItem('manta:theme', JSON.stringify({ presetId: 'custom', config: newTheme }))
                      }
                    }
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }}
                />
              </label>
              <button
                onClick={() => {
                  const newTheme = { ...theme, sidebar: { ...theme.sidebar, wallpaper: '' } }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                className="px-3 py-2 text-xs border border-border rounded-md text-text-secondary hover:bg-surface flex-shrink-0"
              >
                清除
              </button>
            </div>
            {/* AI: 本地图片提示 */}
            {(theme.sidebar.wallpaper ?? '').startsWith('data:') && (
              <p className="mt-1 text-xs text-text-muted">已加载本地图片</p>
            )}
            {/* AI: 背景色透明度滑块（0=完全透明看壁纸，1=完全不透明） */}
            {theme.sidebar.wallpaper && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-secondary">背景色透明度</span>
                  <span className="text-xs text-text-muted font-mono">
                    {Math.round((theme.sidebar.wallpaperOverlay ?? 0.85) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={Math.round((theme.sidebar.wallpaperOverlay ?? 0.85) * 100)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) / 100
                    const newTheme = { ...theme, sidebar: { ...theme.sidebar, wallpaperOverlay: val } }
                    setTheme(newTheme)
                    setActiveThemeId('custom')
                    applyTheme(newTheme)
                  }}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-text-muted mt-0.5">
                  <span>完全透明（看壁纸）</span>
                  <span>完全不透明</span>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* AI end: 侧边栏配置 */}

        {/* AI start: 字体配置 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">字体配置</p>
          <div className="mb-3">
            <label className="block text-xs text-text-muted mb-1">字体族</label>
            <select
              value={theme.font.family}
              onChange={(e) => {
                const newTheme = { ...theme, font: { ...theme.font, family: e.target.value } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary"
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.value} value={font.value}>{font.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const newTheme = { ...theme, font: { ...theme.font, size: 'sm' as const } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
              className={`flex-1 px-3 py-2 text-xs rounded-md border transition-all ${
                theme.font.size === 'sm'
                  ? 'bg-accent text-text-inverse border-accent'
                  : 'bg-surface text-text-secondary border-border hover:border-accent'
              }`}
            >
              小字
            </button>
            <button
              onClick={() => {
                const newTheme = { ...theme, font: { ...theme.font, size: 'md' as const } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
              className={`flex-1 px-3 py-2 text-xs rounded-md border transition-all ${
                theme.font.size === 'md'
                  ? 'bg-accent text-text-inverse border-accent'
                  : 'bg-surface text-text-secondary border-border hover:border-accent'
              }`}
            >
              标准
            </button>
            <button
              onClick={() => {
                const newTheme = { ...theme, font: { ...theme.font, size: 'lg' as const } }
                setTheme(newTheme)
                setActiveThemeId('custom')
                applyTheme(newTheme)
              }}
              className={`flex-1 px-3 py-2 text-xs rounded-md border transition-all ${
                theme.font.size === 'lg'
                  ? 'bg-accent text-text-inverse border-accent'
                  : 'bg-surface text-text-secondary border-border hover:border-accent'
              }`}
            >
              大字
            </button>
          </div>
        </div>
        {/* AI end: 字体配置 */}

        {/* AI start: 布局密度 */}
        <div className="border border-border rounded-lg p-4 mb-4">
          <p className="text-xs font-medium text-text-secondary mb-3">布局密度</p>
          <div className="flex gap-2">
            {(['compact', 'normal', 'comfortable'] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  const newTheme = { ...theme, density: d }
                  setTheme(newTheme)
                  setActiveThemeId('custom')
                  applyTheme(newTheme)
                }}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-all ${
                  theme.density === d
                    ? 'bg-accent text-text-inverse border-accent'
                    : 'bg-surface text-text-secondary border-border hover:border-accent'
                }`}
              >
                {d === 'compact' ? '紧凑' : d === 'normal' ? '标准' : '宽松'}
              </button>
            ))}
          </div>
        </div>
        {/* AI end: 布局密度 */}

        {/* 圆角配置 */}
        <div className="border border-border rounded-lg p-4">
          <p className="text-xs font-medium text-text-secondary mb-3">圆角大小</p>
          <div className="flex gap-2">
            {(['sm', 'md', 'lg', 'xl'] as const).map((r) => (
              <button
                key={r}
                onClick={() => updateThemeColor('radius', r)}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-all ${
                  theme.radius === r
                    ? 'bg-accent text-text-inverse border-accent'
                    : 'bg-surface text-text-secondary border-border hover:border-accent'
                }`}
              >
                {r === 'sm' ? '小' : r === 'md' ? '中' : r === 'lg' ? '大' : '特大'}
              </button>
            ))}
          </div>
        </div>
      </section>
      {/* AI end: 主题配置 */}

      {/* Runner 状态 */}
      <section id="section-runner" className="mb-10 scroll-mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary">Runner 状态</h2>
          <button
            onClick={probeRunners}
            disabled={runnerLoading}
            className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
          >
            {runnerLoading ? '探测中...' : '重新探测'}
          </button>
        </div>

        {runners.length === 0 && !runnerLoading && (
          <p className="text-sm text-text-muted">点击"重新探测"检查 Runner 可用性</p>
        )}

        <div className="space-y-2">
          {runners.map((runner) => (
            <RunnerCard key={runner.id} runner={runner} />
          ))}
        </div>

        <div className="mt-4 p-4 bg-surface border border-border-subtle rounded-lg">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">如何安装 Runner</p>
          <div className="space-y-1.5 text-xs text-text-muted font-mono">
            <div>openclaw: <span className="text-text-secondary">brew install openclaw</span></div>
            <div>claude code: <span className="text-text-secondary">npm install -g @anthropic-ai/claude-code</span></div>
            <div>generic-cli: <span className="text-text-secondary">在 Agent 管理页配置 bin 路径</span></div>
          </div>
        </div>
      </section>

      {/* Webhook Channel */}
      <section id="section-webhook" className="mb-10 scroll-mt-8">
        <h2 className="text-sm font-medium text-text-primary mb-4">Webhook 通知</h2>
        <div className="border border-border rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">启用 Webhook</p>
              <p className="text-xs text-text-muted mt-0.5">任务状态变化时推送通知</p>
            </div>
            <ToggleSwitch
              enabled={webhook.enabled}
              onChange={(v) => setWebhook({ ...webhook, enabled: v })}
            />
          </div>

          {webhook.enabled && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">平台类型</label>
                <select
                  value={webhook.type}
                  onChange={(e) => setWebhook({ ...webhook, type: e.target.value as WebhookConfig['type'] })}
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="feishu">飞书</option>
                  <option value="dingtalk">钉钉</option>
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="generic">通用 Webhook</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Webhook URL</label>
                <input
                  type="text"
                  value={webhook.url}
                  onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  className="w-full px-3 py-2 text-sm border border-border rounded-md bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
                />
              </div>
            </>
          )}

          <div className="flex justify-end">
            <button
              onClick={saveWebhook}
              disabled={webhookSaving}
              className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {webhookSaved ? '✓ 已保存' : webhookSaving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </section>

      {/* 插件管理 */}
      <section id="section-plugins" className="mb-10 scroll-mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-text-primary">已安装插件</h2>
          <button
            onClick={loadPlugins}
            disabled={pluginsLoading}
            className="text-xs px-3 py-1.5 border border-border rounded-md text-text-secondary hover:bg-surface transition-colors disabled:opacity-50"
          >
            {pluginsLoading ? '加载中...' : '刷新'}
          </button>
        </div>

        {/* AI start: 安装新插件表单 */}
        <div className="border border-border rounded-lg p-4 mb-4 bg-surface">
          <p className="text-xs font-medium text-text-secondary mb-3">安装插件（选择本地插件目录）</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={installPkg}
              onChange={(e) => {
                setInstallPkg(e.target.value)
                if (installState !== 'idle') setInstallState('idle')
              }}
              onKeyDown={(e) => e.key === 'Enter' && installPlugin()}
              placeholder="插件目录路径，如 ~/my-plugin 或 /path/to/plugin"
              disabled={installState === 'installing'}
              className="flex-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono disabled:opacity-50"
            />
            {/* AI: 选择文件夹按钮（仅 Electron 环境下可用） */}
            <button
              onClick={browseDirectory}
              disabled={installState === 'installing'}
              title="打开文件夹选择器"
              className="px-3 py-2 text-sm border border-border rounded-md text-text-secondary hover:bg-background transition-colors disabled:opacity-50"
            >
              📂
            </button>
            <button
              onClick={installPlugin}
              disabled={installState === 'installing' || !installPkg.trim()}
              className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {installState === 'installing' ? '安装中...' : '安装'}
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">插件目录内须包含 <span className="font-mono">plugin.yaml</span> 文件，安装后直接复制到 plugins/ 目录生效</p>
          {installMsg && (
            <p className={`mt-1.5 text-xs font-mono ${
              installState === 'success' ? 'text-status-done' : 'text-status-failed'
            }`}>
              {installMsg}
            </p>
          )}
        </div>
        {/* AI end: 安装新插件表单结束 */}

        {plugins.length === 0 && !pluginsLoading && (
          <p className="text-sm text-text-muted">未发现插件</p>
        )}

        <div className="space-y-2">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onToggle={async (id, disabled) => {
                // AI: 乐观更新，立即反映 UI 变化
                setPlugins((prev) => prev.map((p) => p.id === id ? { ...p, disabled } : p))
                try {
                  await fetch(`/api/plugins/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disabled }),
                  })
                } catch {
                  // AI: 失败则回滚
                  await loadPlugins()
                }
              }}
              onUninstall={uninstallPlugin}
            />
          ))}
        </div>
      </section>

      {/* 系统信息 */}
      <section id="section-sysinfo" className="scroll-mt-8">
        <h2 className="text-sm font-medium text-text-primary mb-4">系统信息</h2>
        <div className="border border-border rounded-lg divide-y divide-border-subtle">
          <InfoRow label="版本" value="Manta v2.0.0" />
          <InfoRow label="数据目录" value="~/manta-data/" />
          <InfoRow label="Agent 元数据" value="~/manta-data/agents/" />
          <InfoRow label="任务存储" value="~/manta-data/tasks.json" />
        </div>
      </section>
      </div>
    </div>
  )
}

// AI: Runner 卡片
function RunnerCard({ runner }: { runner: RunnerStatus }) {
  return (
    <div className={`border rounded-lg p-3 flex items-center gap-3 ${
      runner.available ? 'border-border bg-surface' : 'border-border-subtle bg-background'
    }`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        runner.available ? 'bg-status-done' : 'bg-status-failed'
      }`} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-text-primary font-mono">{runner.id}</span>
        {runner.version && (
          <span className="ml-2 text-xs text-text-muted">{runner.version}</span>
        )}
        {!runner.available && runner.reason && (
          <p className="text-xs text-status-failed mt-0.5">{runner.reason}</p>
        )}
      </div>
      <span className={`text-xs ${runner.available ? 'text-status-done' : 'text-status-failed'}`}>
        {runner.available ? '可用' : '不可用'}
      </span>
    </div>
  )
}

// AI: 开关组件
function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        enabled ? 'bg-accent' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/* AI start: 插件卡片组件（支持所有插件启用/禁用，npm 插件支持卸载）*/
const FORMAT_LABEL: Record<string, string> = {
  'openclaw-json': 'openclaw-json',
  'markdown': 'markdown',
  'codeflicker-skill': 'codeflicker-skill',
  'yaml': 'yaml',
}

function PluginCard({
  plugin,
  onToggle,
  onUninstall,
}: {
  plugin: PluginManifest
  onToggle: (id: string, disabled: boolean) => void
  onUninstall: (id: string) => void
}) {
  const [uninstalling, setUninstalling] = useState(false)

  async function handleUninstall() {
    if (!confirm(`确定要卸载插件 "${plugin.name}" 吗？`)) return
    setUninstalling(true)
    await onUninstall(plugin.id)
    setUninstalling(false)
  }

  return (
    <div className={`border rounded-lg p-4 transition-opacity ${
      plugin.disabled ? 'border-border-subtle bg-background opacity-60' : 'border-border bg-surface'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{plugin.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-background border border-border-subtle text-text-muted font-mono">
              {FORMAT_LABEL[plugin.agentFormat] ?? plugin.agentFormat}
            </span>
            {plugin.isNpm && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-background border border-border-subtle text-text-muted">npm</span>
            )}
            {plugin.disabled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-background border border-border-subtle text-status-failed">已禁用</span>
            )}
          </div>
          {plugin.description && (
            <p className="text-xs text-text-muted mt-1">{plugin.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted font-mono">
            <span>id: {plugin.id}</span>
            <span>runner: {plugin.runnerId}</span>
            {plugin.openclawConfigFile && (
              <span>config: {plugin.openclawConfigFile}</span>
            )}
            {plugin.agentsDirs && plugin.agentsDirs.length > 0 && (
              <span>dirs: {plugin.agentsDirs.join(', ')}</span>
            )}
          </div>
        </div>
        {/* AI: 右侧操作区 — 所有插件都有启用/禁用开关，npm 插件额外有卸载按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ToggleSwitch
            enabled={!plugin.disabled}
            onChange={(enabled) => onToggle(plugin.id, !enabled)}
          />
          {plugin.isNpm && (
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              className="text-xs px-2.5 py-1.5 border border-border-subtle rounded text-status-failed hover:bg-background transition-colors disabled:opacity-50"
            >
              {uninstalling ? '卸载中...' : '卸载'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 插件卡片组件结束 */

// AI: 信息行
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs text-text-secondary font-mono">{value}</span>
    </div>
  )
}

// AI start: 颜色选择器组件
function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const presetColors = [
    '#0a0a0a', '#525252', '#a3a3a3', '#ffffff',
    '#ef4444', '#f97316', '#f59e0b', '#84cc16',
    '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  ]

  return (
    <div className="relative" ref={pickerRef}>
      <label className="block text-xs text-text-muted mb-1">{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-3 py-2 border border-border rounded-md bg-surface hover:border-accent transition-colors"
      >
        <div
          className="w-5 h-5 rounded border border-border-subtle"
          style={{ backgroundColor: value }}
        />
        <span className="text-sm text-text-primary font-mono flex-1 text-left">{value}</span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 p-3 bg-surface-elevated border border-border rounded-lg shadow-lg" style={{ minWidth: '200px' }}>
          <div className="grid grid-cols-8 gap-1 mb-2">
            {presetColors.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onChange(color)
                  setIsOpen(false)
                }}
                className="w-5 h-5 rounded border border-border-subtle hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-8 cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}
// AI end: 颜色选择器组件

/*  end: 设置页结束 */
