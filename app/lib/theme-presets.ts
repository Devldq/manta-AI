/* AI start: Manta 主题预设库 — 从 design/theme-presets.json 读取并归一化 */

import rawThemes from '@/design/theme-presets.json'

export interface SidebarConfig {
  background: string
  textPrimary: string
  textSecondary: string
  border: string
  width: number
  collapsedWidth: number
  wallpaper?: string
  wallpaperOverlay?: number
}

export interface FontConfig {
  family: string
  size: 'sm' | 'md' | 'lg'
  lineHeight: 'compact' | 'normal' | 'relaxed'
}

export interface ThemeConfig {
  wallpaper?: string
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

export interface DesignTheme {
  id: string
  name: string
  description: string
  designFile: string
  category: 'light-only' | 'dark-only' | 'both'
  preview: {
    bg: string
    surface: string
    accent: string
    text: string
    border: string
  }
  light: ThemeConfig
  dark: ThemeConfig
}

type PartialSidebarConfig = Partial<SidebarConfig>
type PartialFontConfig = Partial<FontConfig>
type PartialThemeConfig = Omit<Partial<ThemeConfig>, 'sidebar' | 'font'> & {
  sidebar?: PartialSidebarConfig
  font?: PartialFontConfig
}
type RawDesignTheme = Omit<DesignTheme, 'light' | 'dark'> & {
  light: PartialThemeConfig
  dark: PartialThemeConfig
}

// AI: 默认字体配置
const DEFAULT_FONT: FontConfig = {
  family: 'system-ui, -apple-system, sans-serif',
  size: 'md',
  lineHeight: 'normal',
}

/* AI start: 根据主题主配置自动推导侧边栏配置 */
function makeSidebar(bg: string, textPrimary: string, textSecondary: string, border: string): SidebarConfig {
  return {
    background: bg,
    textPrimary,
    textSecondary,
    border,
    width: 240,
    collapsedWidth: 64,
  }
}

// AI: 归一化字体配置
function normalizeFont(font?: PartialFontConfig): FontConfig {
  return {
    family: font?.family ?? DEFAULT_FONT.family,
    size: font?.size ?? DEFAULT_FONT.size,
    lineHeight: font?.lineHeight ?? DEFAULT_FONT.lineHeight,
  }
}

// AI: 归一化侧边栏配置
function normalizeSidebar(config: PartialThemeConfig): SidebarConfig {
  const sidebar = config.sidebar
  const base = makeSidebar(
    sidebar?.background ?? config.surface ?? config.background ?? '#ffffff',
    sidebar?.textPrimary ?? config.textPrimary ?? '#111111',
    sidebar?.textSecondary ?? config.textSecondary ?? config.textMuted ?? '#666666',
    sidebar?.border ?? config.border ?? '#e5e5e5'
  )

  return {
    ...base,
    ...sidebar,
    width: sidebar?.width ?? base.width,
    collapsedWidth: sidebar?.collapsedWidth ?? base.collapsedWidth,
  }
}

// AI: 归一化单个主题模式配置
function normalizeThemeConfig(config: PartialThemeConfig): ThemeConfig {
  const background = config.background ?? '#ffffff'
  const surface = config.surface ?? background
  const surfaceElevated = config.surfaceElevated ?? surface
  const border = config.border ?? '#e5e5e5'
  const borderSubtle = config.borderSubtle ?? border
  const textPrimary = config.textPrimary ?? '#111111'
  const textSecondary = config.textSecondary ?? '#666666'
  const textMuted = config.textMuted ?? '#999999'
  const textInverse = config.textInverse ?? '#ffffff'
  const accent = config.accent ?? '#000000'
  const accentHover = config.accentHover ?? accent
  const accentSubtle = config.accentSubtle ?? surface
  const emphasis = config.emphasis ?? accent
  const emphasisHover = config.emphasisHover ?? accentHover

  return {
    wallpaper: config.wallpaper,
    wallpaperOpacity: config.wallpaperOpacity,
    background,
    surface,
    surfaceElevated,
    border,
    borderSubtle,
    textPrimary,
    textSecondary,
    textMuted,
    textInverse,
    accent,
    accentHover,
    accentSubtle,
    emphasis,
    emphasisHover,
    success: config.success ?? '#16a34a',
    warning: config.warning ?? '#d97706',
    error: config.error ?? '#dc2626',
    info: config.info ?? '#2563eb',
    radius: config.radius ?? 'md',
    sidebar: normalizeSidebar(config),
    font: normalizeFont(config.font),
    density: config.density ?? 'normal',
  }
}

// AI: 归一化主题列表
function normalizeDesignTheme(theme: RawDesignTheme): DesignTheme {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    designFile: theme.designFile,
    category: theme.category,
    preview: {
      bg: theme.preview?.bg ?? theme.light.background ?? '#ffffff',
      surface: theme.preview?.surface ?? theme.light.surface ?? '#f5f5f5',
      accent: theme.preview?.accent ?? theme.light.accent ?? '#000000',
      text: theme.preview?.text ?? theme.light.textPrimary ?? '#111111',
      border: theme.preview?.border ?? theme.light.border ?? '#e5e5e5',
    },
    light: normalizeThemeConfig(theme.light),
    dark: normalizeThemeConfig(theme.dark),
  }
}

/** 所有设计主题列表（用于主题选择页展示） */
export const DESIGN_THEMES: DesignTheme[] = (rawThemes as RawDesignTheme[]).map(normalizeDesignTheme)

/** 通过 id 查找主题 */
export function getThemeById(id: string): DesignTheme | undefined {
  return DESIGN_THEMES.find((t) => t.id === id)
}

/** 根据色彩模式获取对应 ThemeConfig */
export function getThemeConfig(theme: DesignTheme, mode: 'light' | 'dark'): ThemeConfig {
  return mode === 'dark' ? theme.dark : theme.light
}

/** 将 ThemeConfig 的 CSS 变量应用到 document.documentElement */
export function applyTheme(config: ThemeConfig): void {
  const root = document.documentElement
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
  root.style.setProperty('--color-emphasis', config.emphasis)
  root.style.setProperty('--color-emphasis-hover', config.emphasisHover)
  root.style.setProperty('--color-status-done', config.success)
  root.style.setProperty('--color-status-pending', config.warning)
  root.style.setProperty('--color-status-failed', config.error)
  root.style.setProperty('--color-status-running', config.info)

  const rMap = {
    sm: ['4px', '6px', '8px', '12px'],
    md: ['6px', '8px', '12px', '16px'],
    lg: ['8px', '12px', '16px', '20px'],
    xl: ['12px', '16px', '20px', '24px'],
  }
  const rVals = rMap[config.radius] ?? rMap.md
  root.style.setProperty('--radius-sm', rVals[0])
  root.style.setProperty('--radius-md', rVals[1])
  root.style.setProperty('--radius-lg', rVals[2])
  root.style.setProperty('--radius-xl', rVals[3])

  root.style.setProperty('--sidebar-bg', config.sidebar.background)
  root.style.setProperty('--sidebar-text', config.sidebar.textPrimary)
  root.style.setProperty('--sidebar-text-secondary', config.sidebar.textSecondary)
  root.style.setProperty('--sidebar-border', config.sidebar.border)
  root.style.setProperty('--sidebar-width', `${config.sidebar.width}px`)
  root.style.setProperty('--sidebar-collapsed-width', `${config.sidebar.collapsedWidth}px`)

  if (config.sidebar.wallpaper) {
    const sbWallpaper = config.sidebar.wallpaper.startsWith('data:')
      ? `url("${config.sidebar.wallpaper}")`
      : `url(${config.sidebar.wallpaper})`
    root.style.setProperty('--sidebar-wallpaper', sbWallpaper)
    root.style.setProperty('--sidebar-bg-opacity', String(config.sidebar.wallpaperOverlay ?? 0.85))
  } else {
    root.style.setProperty('--sidebar-wallpaper', 'none')
    root.style.setProperty('--sidebar-bg-opacity', '1')
  }

  root.style.setProperty('--font-family', config.font.family)
  root.style.setProperty(
    '--font-size-scale',
    config.font.size === 'sm' ? '0.875' : config.font.size === 'md' ? '1' : '1.125'
  )
  root.style.setProperty(
    '--line-height',
    config.font.lineHeight === 'compact' ? '1.25' : config.font.lineHeight === 'normal' ? '1.5' : '1.75'
  )

  const dMap = {
    compact: ['0.75', '0.5rem', '0.5rem'],
    normal: ['1', '1rem', '0.75rem'],
    comfortable: ['1.25', '1.5rem', '1rem'],
  }
  const dVals = dMap[config.density] ?? dMap.normal
  root.style.setProperty('--density-scale', dVals[0])
  root.style.setProperty('--density-padding', dVals[1])
  root.style.setProperty('--density-gap', dVals[2])

  if (config.wallpaper) {
    const wallpaperValue = config.wallpaper.startsWith('data:')
      ? `url("${config.wallpaper}")`
      : `url(${config.wallpaper})`
    root.style.setProperty('--main-wallpaper', wallpaperValue)
    root.style.setProperty('--main-bg-opacity', String(config.wallpaperOpacity ?? 0.85))
  } else {
    root.style.setProperty('--main-wallpaper', 'none')
    root.style.setProperty('--main-bg-opacity', '1')
  }
}

/** 保存主题配置到 localStorage */
export function saveThemeToStorage(themeId: string, config: ThemeConfig, mode: 'light' | 'dark'): void {
  localStorage.setItem('manta:theme', JSON.stringify({ themeId, mode, config }))
  localStorage.setItem('manta:color-mode', mode)
}

/** 从 localStorage 恢复主题配置 */
export function loadThemeFromStorage(): { themeId: string; mode: 'light' | 'dark'; config: ThemeConfig } | null {
  try {
    const saved = localStorage.getItem('manta:theme')
    if (!saved) return null
    const parsed = JSON.parse(saved)
    if (!parsed.config) return null
    return {
      themeId: parsed.themeId ?? parsed.presetId ?? 'cli-pixel',
      mode: parsed.mode ?? (localStorage.getItem('manta:color-mode') as 'light' | 'dark') ?? 'dark',
      config: parsed.config,
    }
  } catch {
    return null
  }
}

/* AI end: Manta 主题预设库 */
