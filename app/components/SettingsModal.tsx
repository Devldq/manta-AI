/* AI start: 设置弹窗 — 包含主题选择和系统设置两个 Tab */
'use client'

import { useState, useEffect, useCallback } from 'react'
import React from 'react'
import {
  DESIGN_THEMES,
  DesignTheme,
  ThemeConfig,
  applyTheme,
  loadThemeFromStorage,
  getThemeById,
  getThemeConfig,
  saveThemeToStorage,
} from '../lib/theme-presets'
import { setColorModeClass } from './ThemeInitializer'

/* AI start: 类型定义 */
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
/* AI end: 类型定义 */

type TabType = 'theme' | 'settings' | 'llm'
type FilterMode = 'all' | 'light' | 'dark'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  colorMode: 'light' | 'dark'
  onColorModeChange: (mode: 'light' | 'dark') => void
}

export function SettingsModal({ open, onClose, colorMode, onColorModeChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('theme')

  // AI: 点击遮罩关闭
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // AI: ESC 关闭
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '780px',
          maxWidth: '95vw',
          height: '82vh',
          maxHeight: '720px',
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
        }}
      >
        {/* AI: 弹窗 Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
            height: '52px',
          }}
        >
          {/* AI: Tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {([
              { key: 'theme', label: '◐ 主题' },
              { key: 'settings', label: '◌ 设置' },
              { key: 'llm', label: '⬡ AI 模型' },
            ] as { key: TabType; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: activeTab === key ? 600 : 400,
                  color: activeTab === key ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                  background: activeTab === key ? 'var(--color-accent)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* AI: 亮暗切换 + 关闭 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                padding: '3px',
                borderRadius: '8px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                onClick={() => onColorModeChange('light')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: colorMode === 'light' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                  background: colorMode === 'light' ? 'var(--color-accent)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>☀</span>
                <span>亮色</span>
              </button>
              <button
                onClick={() => onColorModeChange('dark')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: colorMode === 'dark' ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                  background: colorMode === 'dark' ? 'var(--color-accent)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>☾</span>
                <span>暗色</span>
              </button>
            </div>
            <button
              onClick={onClose}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '8px',
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* AI: Tab 内容区（可滚动） */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'theme' && (
            <ThemeTab colorMode={colorMode} onColorModeChange={onColorModeChange} />
          )}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'llm' && <LLMTab />}
        </div>
      </div>
    </div>
  )
}

/* AI start: 主题 Tab */
function ThemeTab({
  colorMode,
  onColorModeChange,
}: {
  colorMode: 'light' | 'dark'
  onColorModeChange: (mode: 'light' | 'dark') => void
}) {
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [activeThemeId, setActiveThemeId] = useState<string>('cli-pixel')
  const [showCustomize, setShowCustomize] = useState(false)
  const [customTheme, setCustomTheme] = useState<ThemeConfig | null>(null)

  useEffect(() => {
    const saved = loadThemeFromStorage()
    if (saved) {
      setActiveThemeId(saved.themeId)
      setCustomTheme(saved.config)
    } else {
      setActiveThemeId('cli-pixel')
    }
  }, [])

  function applyDesignTheme(theme: DesignTheme) {
    const config = getThemeConfig(theme, colorMode)
    applyTheme(config)
    setActiveThemeId(theme.id)
    setCustomTheme(config)
    saveThemeToStorage(theme.id, config, colorMode)
  }

  const filteredThemes = DESIGN_THEMES.filter((t) => {
    if (filterMode === 'all') return true
    if (filterMode === 'light') return t.category !== 'dark-only'
    if (filterMode === 'dark') return t.category !== 'light-only'
    return true
  })

  const activeTheme = getThemeById(activeThemeId)

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 20px' }}>
      {/* AI: 当前主题信息栏 */}
      {activeTheme && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: '10px',
            marginBottom: '14px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-accent)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            {[activeTheme.preview.bg, activeTheme.preview.surface, activeTheme.preview.accent, activeTheme.preview.text].map((c, i) => (
              <div
                key={i}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: colorMode === 'dark'
                    ? [activeTheme.dark.background, activeTheme.dark.surface, activeTheme.dark.accent, activeTheme.dark.textPrimary][i]
                    : [activeTheme.light.background, activeTheme.light.surface, activeTheme.light.accent, activeTheme.light.textPrimary][i],
                  border: '1px solid var(--color-border)',
                }}
              />
            ))}
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '13px', margin: 0 }}>
              当前：{activeTheme.name}
            </p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '11px', margin: '1px 0 0' }}>
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
              flexShrink: 0,
            }}
          >
            {colorMode === 'dark' ? '暗色' : '亮色'}
          </span>
        </div>
      )}

      {/* AI: 过滤 Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
        {(['all', 'light', 'dark'] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setFilterMode(mode)}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              background: filterMode === mode ? 'var(--color-accent)' : 'transparent',
              color: filterMode === mode ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: `1px solid ${filterMode === mode ? 'var(--color-accent)' : 'var(--color-border)'}`,
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {mode === 'all' ? '全部' : mode === 'light' ? '☀ 亮色' : '☾ 暗色'}
          </button>
        ))}
        <span style={{ color: 'var(--color-text-muted)', fontSize: '11px', marginLeft: '4px' }}>
          {filteredThemes.length} 款
        </span>
      </div>

      {/* AI: 主题卡片网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
          gap: '10px',
          marginBottom: '16px',
        }}
      >
        {filteredThemes.map((theme) => {
          const isActive = theme.id === activeThemeId
          const themeColors = colorMode === 'dark' ? theme.dark : theme.light

          return (
            <div
              key={theme.id}
              onClick={() => applyDesignTheme(theme)}
              style={{
                borderRadius: '10px',
                overflow: 'hidden',
                cursor: 'pointer',
                border: isActive ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                boxShadow: isActive ? `0 0 10px rgba(${hexToRgb(themeColors.accent)}, 0.25)` : 'none',
                transition: 'all 0.15s',
              }}
            >
              {/* AI: 主题色板预览 */}
              <div style={{ height: '60px', position: 'relative', overflow: 'hidden', background: themeColors.background }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: '36px',
                    background: themeColors.surface,
                    borderRight: `1px solid ${themeColors.border}`,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', paddingTop: '8px' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: themeColors.accent }} />
                    {[1,2,3].map(i => (
                      <div key={i} style={{ width: '12px', height: '3px', borderRadius: '2px', background: themeColors.border }} />
                    ))}
                  </div>
                </div>
                <div style={{ marginLeft: '42px', paddingTop: '8px', paddingRight: '8px' }}>
                  <div style={{ height: '8px', borderRadius: '3px', width: '70%', background: themeColors.textPrimary, opacity: 0.8, marginBottom: '4px' }} />
                  <div style={{ height: '5px', borderRadius: '2px', width: '100%', background: themeColors.textSecondary, opacity: 0.3, marginBottom: '3px' }} />
                  <div style={{ height: '5px', borderRadius: '2px', width: '80%', background: themeColors.textSecondary, opacity: 0.25 }} />
                </div>
              </div>

              {/* AI: 主题信息 */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.1px' }}>
                    {theme.name}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <a
                      href={getDesignDocUrl(theme)}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      title={`查看 ${theme.name} 设计规范`}
                      style={{
                        color: 'var(--color-text-muted)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-background)',
                        width: '18px',
                        height: '18px',
                        borderRadius: '4px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textDecoration: 'none',
                        fontSize: '10px',
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
                          padding: '1px 5px',
                          borderRadius: '999px',
                          fontWeight: 600,
                        }}
                      >
                        当前
                      </span>
                    )}
                  </div>
                </div>
                {/* AI: 色板小圆点 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {[themeColors.background, themeColors.surface, themeColors.accent, themeColors.textPrimary, themeColors.border].map((c, i) => (
                    <div
                      key={i}
                      title={c}
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: c,
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* AI: 高级自定义面板 */}
      <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <button
          onClick={() => setShowCustomize(!showCustomize)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>✦</span>
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontWeight: 600, fontSize: '13px', margin: 0 }}>高级自定义</p>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '11px', margin: 0 }}>
                微调颜色、字体和布局密度
              </p>
            </div>
          </div>
          <span
            style={{
              color: 'var(--color-text-muted)',
              fontSize: '11px',
              transition: 'transform 0.2s',
              transform: showCustomize ? 'rotate(180deg)' : 'none',
            }}
          >
            ▼
          </span>
        </button>
        {showCustomize && customTheme && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--color-border)' }}>
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
  )
}
/* AI end: 主题 Tab */

/* AI start: 设置 Tab */
function SettingsTab() {
  const [readme, setReadme] = useState('')
  const [readmeLoading, setReadmeLoading] = useState(true)
  const [runners, setRunners] = useState<RunnerStatus[]>([])
  const [runnerLoading, setRunnerLoading] = useState(false)
  const [webhook, setWebhook] = useState<WebhookConfig>({ url: '', type: 'feishu', enabled: false })
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookSaved, setWebhookSaved] = useState(false)
  const [plugins, setPlugins] = useState<PluginManifest[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [installPkg, setInstallPkg] = useState('')
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'success' | 'error'>('idle')
  const [installMsg, setInstallMsg] = useState('')
  const [isElectron, setIsElectron] = useState(false)

  const probeRunners = useCallback(async () => {
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
  }, [])

  const loadPlugins = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    const api = (window as Window & { electronAPI?: { selectDirectory?: unknown } }).electronAPI
    setIsElectron(typeof api?.selectDirectory === 'function')
    probeRunners()
    loadPlugins()
    const saved = localStorage.getItem('manta:webhook')
    if (saved) {
      try { setWebhook(JSON.parse(saved)) } catch {}
    }
    fetch('/api/readme')
      .then((r) => r.json())
      .then((d) => setReadme(d.content ?? ''))
      .catch(() => setReadme('README.md 加载失败'))
      .finally(() => setReadmeLoading(false))
  }, [probeRunners, loadPlugins])

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

  async function browseDirectory() {
    if (isElectron) {
      const api = (window as unknown as { electronAPI: { selectDirectory: () => Promise<string | null> } }).electronAPI
      const selected = await api.selectDirectory()
      if (selected) {
        setInstallPkg(selected)
        if (installState !== 'idle') setInstallState('idle')
      }
    } else {
      const input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('webkitdirectory', '')
      input.onchange = () => {
        const files = input.files
        if (files && files.length > 0) {
          const firstFile = files[0] as File & { path?: string }
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

  function saveWebhook() {
    setWebhookSaving(true)
    localStorage.setItem('manta:webhook', JSON.stringify(webhook))
    setTimeout(() => {
      setWebhookSaving(false)
      setWebhookSaved(true)
      setTimeout(() => setWebhookSaved(false), 2000)
    }, 300)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 20px' }}>
      {/* ─── 系统介绍 ─── */}
      <section style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 8px' }}>
          系统介绍
        </h2>
        <div
          style={{
            borderRadius: '8px',
            overflow: 'auto',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            maxHeight: '200px',
          }}
        >
          {readmeLoading ? (
            <div style={{ padding: '16px', color: 'var(--color-text-muted)', fontSize: '13px' }}>加载中...</div>
          ) : (
            <MarkdownView content={readme} />
          )}
        </div>
      </section>

      {/* ─── Runner 状态 ─── */}
      <section style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
            Runner 状态
          </h2>
          <button
            onClick={probeRunners}
            disabled={runnerLoading}
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              color: 'var(--color-text-secondary)',
              background: 'transparent',
              cursor: 'pointer',
              opacity: runnerLoading ? 0.5 : 1,
            }}
          >
            {runnerLoading ? '探测中...' : '重新探测'}
          </button>
        </div>

        {runners.length === 0 && !runnerLoading && (
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>点击"重新探测"检查 Runner 可用性</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {runners.map((runner) => (
            <RunnerCard key={runner.id} runner={runner} />
          ))}
        </div>
        <div
          style={{
            marginTop: '10px',
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            如何安装 Runner
          </p>
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            openclaw: <span style={{ color: 'var(--color-text-secondary)' }}>brew install openclaw</span>
          </div>
        </div>
      </section>

      {/* ─── Webhook ─── */}
      <section style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 10px' }}>
          Webhook 通知
        </h2>
        <div style={{ borderRadius: '8px', padding: '14px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>启用 Webhook</p>
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>任务状态变化时推送通知</p>
            </div>
            <ToggleSwitch enabled={webhook.enabled} onChange={(v) => setWebhook({ ...webhook, enabled: v })} />
          </div>
          {webhook.enabled && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  平台类型
                </label>
                <select
                  value={webhook.type}
                  onChange={(e) => setWebhook({ ...webhook, type: e.target.value as WebhookConfig['type'] })}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    fontSize: '13px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <option value="feishu">飞书</option>
                  <option value="dingtalk">钉钉</option>
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="generic">通用 Webhook</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  Webhook URL
                </label>
                <input
                  type="text"
                  value={webhook.url}
                  onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    fontSize: '13px',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-mono)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={saveWebhook}
              disabled={webhookSaving}
              style={{
                padding: '7px 14px',
                fontSize: '12px',
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                opacity: webhookSaving ? 0.5 : 1,
              }}
            >
              {webhookSaved ? '✓ 已保存' : webhookSaving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </section>

      {/* ─── 插件管理 ─── */}
      <section style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
            已安装插件
          </h2>
          <button
            onClick={loadPlugins}
            disabled={pluginsLoading}
            style={{
              fontSize: '11px',
              padding: '4px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              color: 'var(--color-text-secondary)',
              background: 'transparent',
              cursor: 'pointer',
              opacity: pluginsLoading ? 0.5 : 1,
            }}
          >
            {pluginsLoading ? '加载中...' : '刷新'}
          </button>
        </div>

        <div style={{ borderRadius: '8px', padding: '12px', marginBottom: '10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
            安装插件（选择本地插件目录）
          </p>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="text"
              value={installPkg}
              onChange={(e) => {
                setInstallPkg(e.target.value)
                if (installState !== 'idle') setInstallState('idle')
              }}
              onKeyDown={(e) => e.key === 'Enter' && installPlugin()}
              placeholder="插件目录路径，如 ~/my-plugin"
              disabled={installState === 'installing'}
              style={{
                flex: 1,
                padding: '7px 10px',
                fontSize: '12px',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                background: 'var(--color-background)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                opacity: installState === 'installing' ? 0.5 : 1,
              }}
            />
            <button
              onClick={browseDirectory}
              disabled={installState === 'installing'}
              style={{
                padding: '7px 10px',
                fontSize: '13px',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              📂
            </button>
            <button
              onClick={installPlugin}
              disabled={installState === 'installing' || !installPkg.trim()}
              style={{
                padding: '7px 12px',
                fontSize: '12px',
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                opacity: (installState === 'installing' || !installPkg.trim()) ? 0.5 : 1,
              }}
            >
              {installState === 'installing' ? '安装中...' : '安装'}
            </button>
          </div>
          {installMsg && (
            <p
              style={{
                marginTop: '6px',
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                color: installState === 'success' ? 'var(--color-status-done)' : 'var(--color-status-failed)',
              }}
            >
              {installMsg}
            </p>
          )}
        </div>

        {plugins.length === 0 && !pluginsLoading && (
          <p style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>未发现插件</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onToggle={async (id, disabled) => {
                setPlugins((prev) => prev.map((p) => p.id === id ? { ...p, disabled } : p))
                try {
                  await fetch(`/api/plugins/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disabled }),
                  })
                } catch {
                  await loadPlugins()
                }
              }}
              onUninstall={async (id) => {
                try {
                  const res = await fetch('/api/plugins/install', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pluginId: id }),
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
              }}
            />
          ))}
        </div>
      </section>

      {/* ─── 系统信息 ─── */}
      <section>
        <h2 style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 10px' }}>
          系统信息
        </h2>
        <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
          <InfoRow label="版本" value="Manta v2.0.0" />
          <InfoRow label="数据目录" value="~/manta-data/" />
          <InfoRow label="会话存储" value="~/manta-data/conversations/" />
        </div>
      </section>
    </div>
  )
}
/* AI end: 设置 Tab */

/* AI start: 自定义面板 */
function CustomizePanel({ config, onChange }: { config: ThemeConfig; onChange: (config: ThemeConfig) => void }) {
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
    <div style={{ paddingTop: '12px' }}>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 500, marginBottom: '10px' }}>颜色微调</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '14px' }}>
        {colorFields.map(({ key, label }) => (
          <MiniColorPicker key={key} label={label} value={String(config[key] ?? '')} onChange={(v) => update(key, v)} />
        ))}
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>圆角大小</p>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {(['sm', 'md', 'lg', 'xl'] as const).map((r) => (
          <button
            key={r}
            onClick={() => onChange({ ...config, radius: r })}
            style={{
              flex: 1,
              padding: '6px',
              borderRadius: '6px',
              background: config.radius === r ? 'var(--color-accent)' : 'var(--color-surface)',
              color: config.radius === r ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: `1px solid ${config.radius === r ? 'var(--color-accent)' : 'var(--color-border)'}`,
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {r === 'sm' ? '小' : r === 'md' ? '中' : r === 'lg' ? '大' : '特大'}
          </button>
        ))}
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>布局密度</p>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {(['compact', 'normal', 'comfortable'] as const).map((d) => (
          <button
            key={d}
            onClick={() => onChange({ ...config, density: d })}
            style={{
              flex: 1,
              padding: '6px',
              borderRadius: '6px',
              background: config.density === d ? 'var(--color-accent)' : 'var(--color-surface)',
              color: config.density === d ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
              border: `1px solid ${config.density === d ? 'var(--color-accent)' : 'var(--color-border)'}`,
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {d === 'compact' ? '紧凑' : d === 'normal' ? '标准' : '宽松'}
          </button>
        ))}
      </div>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>背景壁纸</p>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          type="text"
          value={(config.wallpaper ?? '').startsWith('data:') ? '[本地图片]' : (config.wallpaper ?? '')}
          onChange={(e) => onChange({ ...config, wallpaper: e.target.value })}
          placeholder="输入图片 URL"
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        />
        <label
          style={{
            padding: '7px 10px',
            borderRadius: '6px',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          📁
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
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
          style={{
            padding: '7px 10px',
            borderRadius: '6px',
            fontSize: '12px',
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
function MiniColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <input
        type="color"
        value={value.startsWith('#') ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '28px', height: '28px', borderRadius: '6px', padding: '1px', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '11px', margin: 0 }}>{label}</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '10px', fontFamily: 'monospace', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </p>
      </div>
    </div>
  )
}
/* AI end: MiniColorPicker */

/* AI start: Runner 卡片 */
function RunnerCard({ runner }: { runner: RunnerStatus }) {
  return (
    <div
      style={{
        borderRadius: '8px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        border: `1px solid ${runner.available ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
        background: runner.available ? 'var(--color-surface)' : 'var(--color-background)',
      }}
    >
      <div style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: runner.available ? 'var(--color-status-done)' : 'var(--color-status-failed)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{runner.id}</span>
        {runner.version && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--color-text-muted)' }}>{runner.version}</span>}
        {!runner.available && runner.reason && (
          <p style={{ fontSize: '11px', color: 'var(--color-status-failed)', marginTop: '1px' }}>{runner.reason}</p>
        )}
      </div>
      <span style={{ fontSize: '11px', color: runner.available ? 'var(--color-status-done)' : 'var(--color-status-failed)' }}>
        {runner.available ? '可用' : '不可用'}
      </span>
    </div>
  )
}
/* AI end: Runner 卡片 */

/* AI start: 开关组件 */
function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        height: '20px',
        width: '36px',
        alignItems: 'center',
        borderRadius: '9999px',
        border: 'none',
        background: enabled ? 'var(--color-accent)' : 'var(--color-border)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          height: '14px',
          width: '14px',
          transform: `translateX(${enabled ? '18px' : '3px'})`,
          borderRadius: '50%',
          background: '#fff',
          transition: 'transform 0.2s',
        }}
      />
    </button>
  )
}
/* AI end: 开关组件 */

/* AI start: 插件卡片 */
const FORMAT_LABEL: Record<string, string> = {
  'openclaw-json': 'openclaw-json',
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
    <div
      style={{
        borderRadius: '8px',
        padding: '12px',
        border: `1px solid ${plugin.disabled ? 'var(--color-border-subtle)' : 'var(--color-border)'}`,
        background: plugin.disabled ? 'var(--color-background)' : 'var(--color-surface)',
        opacity: plugin.disabled ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>{plugin.name}</span>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 5px',
                borderRadius: '4px',
                background: 'var(--color-background)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {FORMAT_LABEL[plugin.agentFormat] ?? plugin.agentFormat}
            </span>
            {plugin.disabled && (
              <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '4px', background: 'var(--color-background)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-status-failed)' }}>
                已禁用
              </span>
            )}
          </div>
          {plugin.description && (
            <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '3px' }}>{plugin.description}</p>
          )}
          <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>id: {plugin.id}</span>
            <span>runner: {plugin.runnerId}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <ToggleSwitch enabled={!plugin.disabled} onChange={(enabled) => onToggle(plugin.id, !enabled)} />
          {plugin.isNpm && (
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              style={{
                fontSize: '11px',
                padding: '4px 8px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '4px',
                color: 'var(--color-status-failed)',
                background: 'transparent',
                cursor: 'pointer',
                opacity: uninstalling ? 0.5 : 1,
              }}
            >
              {uninstalling ? '卸载中...' : '卸载'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 插件卡片 */

/* AI start: 信息行 */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}
/* AI end: 信息行 */

/* AI start: 简易 Markdown 渲染 */
function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []

  function flushCode() {
    if (codeLines.length === 0) return
    elements.push(
      <pre
        key={`code-${elements.length}`}
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '10px 12px',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-secondary)',
          overflowX: 'auto',
          margin: '6px 0',
          lineHeight: 1.5,
        }}
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
    codeLines = []
  }

  function renderInline(text: string): React.ReactNode {
    const parts: React.ReactNode[] = []
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
    let last = 0
    let match: RegExpExecArray | null
    let idx = 0
    while ((match = re.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index))
      const token = match[0]
      if (token.startsWith('`')) {
        parts.push(<code key={idx++} style={{ fontFamily: 'monospace', fontSize: '11px', background: 'var(--color-background)', padding: '1px 3px', borderRadius: '3px', color: 'var(--color-accent)' }}>{token.slice(1, -1)}</code>)
      } else if (token.startsWith('**')) {
        parts.push(<strong key={idx++} style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{token.slice(2, -2)}</strong>)
      } else if (token.startsWith('*')) {
        parts.push(<em key={idx++}>{token.slice(1, -1)}</em>)
      } else {
        const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
        if (linkMatch) {
          parts.push(<a key={idx++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>{linkMatch[1]}</a>)
        } else {
          parts.push(token)
        }
      }
      last = match.index + token.length
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts.length === 1 ? parts[0] : parts
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      if (inCodeBlock) { flushCode(); inCodeBlock = false }
      else { inCodeBlock = true }
      continue
    }
    if (inCodeBlock) { codeLines.push(line); continue }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '12px 0 4px' }}>{renderInline(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '16px 0 6px', paddingBottom: '4px', borderBottom: '1px solid var(--color-border)' }}>{renderInline(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-primary)', margin: '0 0 10px' }}>{renderInline(line.slice(2))}</h1>)
    } else if (/^[-*] /.test(line)) {
      elements.push(<li key={i} style={{ fontSize: '12px', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginLeft: '14px', listStyleType: 'disc' }}>{renderInline(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '4px' }} />)
    } else {
      elements.push(<p key={i} style={{ fontSize: '12px', color: 'var(--color-text-secondary)', margin: '3px 0', lineHeight: 1.6 }}>{renderInline(line)}</p>)
    }
  }
  if (inCodeBlock) flushCode()

  return <div style={{ padding: '14px 16px', minHeight: '40px' }}>{elements}</div>
}
/* AI end: MarkdownView */

/* AI start: 辅助函数 */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '0,0,0'
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
}

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
/* AI end: 辅助函数 */

/*  start: LLM 配置 Tab — 支持 OpenAI / 兼容 API / Ollama / LM Studio */
function LLMTab() {
  // ─── 类型定义 ───
  type LLMProvider = 'openai' | 'openai-compatible' | 'ollama' | 'lm-studio'

  interface ModelProfileLocal {
    id: string
    name: string
    isDefault?: boolean
    provider: LLMProvider
    apiKey?: string
    baseUrl?: string
    model: string
    temperature?: number
    maxTokens?: number
    /** Agent Loop 累计输出 token 预算上限，0 = 不限 */
    maxOutputTokens?: number
    /** Agent Loop 最大步数上限，0 = 不限 */
    maxSteps?: number
    apiKeyMasked?: string
  }

  // ─── 常量 ───
  const PROVIDERS: { value: LLMProvider; label: string; desc: string }[] = [
    { value: 'openai', label: 'OpenAI', desc: 'api.openai.com — GPT-4o、GPT-3.5 等' },
    { value: 'openai-compatible', label: 'OpenAI 兼容 API', desc: 'DeepSeek、通义千问、Moonshot 等' },
    { value: 'ollama', label: 'Ollama（本地）', desc: 'localhost:11434 — 本地运行的 Ollama 服务' },
    { value: 'lm-studio', label: 'LM Studio（本地）', desc: 'localhost:1234 — LM Studio 本地服务' },
  ]

  const MODEL_SUGGESTIONS: Record<LLMProvider, string[]> = {
    'openai': ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    'openai-compatible': ['deepseek-chat', 'deepseek-reasoner', 'qwen-turbo', 'qwen-plus', 'moonshot-v1-8k', 'glm-4'],
    'ollama': ['llama3.2', 'llama3.1', 'qwen2.5', 'deepseek-r1', 'mistral', 'phi4'],
    'lm-studio': ['local-model'],
  }

  const DEFAULT_BASE_URLS: Partial<Record<LLMProvider, string>> = {
    'openai': 'https://api.openai.com/v1',
    'ollama': 'http://localhost:11434',
    'lm-studio': 'http://localhost:1234/v1',
  }

  const PROVIDER_ICON: Record<LLMProvider, string> = {
    'openai': '🟢',
    'openai-compatible': '🔵',
    'ollama': '🦙',
    'lm-studio': '🏠',
  }

  // ─── 状态 ───
  const [profiles, setProfiles] = useState<ModelProfileLocal[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)  // 正在编辑的 profile id
  const [isCreating, setIsCreating] = useState(false)  // 是否正在新建
  const [editForm, setEditForm] = useState<ModelProfileLocal | null>(null)  // 编辑表单临时数据
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // ─── 加载配置 ───
  useEffect(() => {
    fetch('/api/chat/config')
      .then((r) => r.json())
      .then((data) => {
        const maskedProfiles = data.profilesMasked || []
        setProfiles(maskedProfiles.map((p: ModelProfileLocal) => ({
          id: p.id,
          name: p.name,
          isDefault: p.isDefault,
          provider: p.provider ?? 'openai',
          apiKey: '',  // apiKey 脱敏，不回显
          baseUrl: p.baseUrl ?? '',
          model: p.model ?? 'gpt-4o-mini',
          temperature: p.temperature ?? 0.7,
          maxTokens: p.maxTokens,
          maxOutputTokens: p.maxOutputTokens,
          maxSteps: p.maxSteps,
          apiKeyMasked: p.apiKeyMasked ?? (p.apiKey === '****' ? '****' : undefined),
        })))
        setActiveProfileId(data.activeProfileId || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ─── Provider 切换（编辑表单） ───
  function handleProviderChange(provider: LLMProvider) {
    if (!editForm) return
    setEditForm({
      ...editForm,
      provider,
      baseUrl: DEFAULT_BASE_URLS[provider] ?? '',
      model: MODEL_SUGGESTIONS[provider][0] ?? '',
    })
    setMsg(null)
  }

  // ─── 进入编辑模式 ───
  function startEdit(profile: ModelProfileLocal) {
    setEditingId(profile.id)
    setIsCreating(false)
    setEditForm({ ...profile })
    setMsg(null)
  }

  // ─── 进入新建模式 ───
  function startCreate() {
    setIsCreating(true)
    setEditingId(null)
    setEditForm({
      id: '',  // 新建时 id 为空，后端会生成
      name: '',
      provider: 'openai',
      apiKey: '',
      baseUrl: DEFAULT_BASE_URLS['openai'] ?? '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxOutputTokens: 1_000_000,
      maxSteps: 200,
    })
    setMsg(null)
  }

  // ─── 取消编辑 ───
  function cancelEdit() {
    setEditingId(null)
    setIsCreating(false)
    setEditForm(null)
    setMsg(null)
  }

  // ─── 保存编辑 ───
  async function handleSave() {
    if (!editForm) return
    setSaving(true)
    setMsg(null)

    try {
      const payload = { ...editForm }
      if (!payload.apiKey?.trim()) delete payload.apiKey

      if (isCreating) {
        // 新建 profile
        const res = await fetch('/api/chat/config?action=profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'add', profile: payload }),
        })
        const data = await res.json()
        if (data.success) {
          setMsg({ type: 'success', text: '配置已添加' })
          // 重新加载列表
          await reloadProfiles()
          cancelEdit()
        } else {
          setMsg({ type: 'error', text: data.error ?? '添加失败' })
        }
      } else {
        // 更新已有 profile
        const res = await fetch('/api/chat/config?action=profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'update', profileId: editingId, profile: payload }),
        })
        const data = await res.json()
        if (data.success) {
          setMsg({ type: 'success', text: '配置已保存' })
          await reloadProfiles()
          cancelEdit()
        } else {
          setMsg({ type: 'error', text: data.error ?? '保存失败' })
        }
      }
    } catch {
      setMsg({ type: 'error', text: '请求失败' })
    } finally {
      setSaving(false)
    }
  }

  // ─── 删除配置 ───
  async function handleDelete(id: string) {
    try {
      const res = await fetch('/api/chat/config?action=profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'delete', profileId: id }),
      })
      const data = await res.json()
      if (data.success) {
        await reloadProfiles()
      } else {
        setMsg({ type: 'error', text: data.error ?? '删除失败' })
      }
    } catch {
      setMsg({ type: 'error', text: '请求失败' })
    }
  }

  // ─── 切换激活配置 ───
  async function handleSetActive(id: string) {
    try {
      const res = await fetch('/api/chat/config?action=active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
      const data = await res.json()
      if (data.success) {
        setActiveProfileId(id)
        await reloadProfiles()
      }
    } catch {
      // ignore
    }
  }

  // ─── 设为默认 ───
  async function handleSetDefault(id: string) {
    try {
      const res = await fetch('/api/chat/config?action=default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: id }),
      })
      const data = await res.json()
      if (data.success) {
        await reloadProfiles()
      }
    } catch {
      // ignore
    }
  }

  // ─── 测试连通性 ───
  async function handleTest() {
    if (!editForm) return
    setTesting(true)
    setMsg(null)

    try {
      const payload = { ...editForm }
      if (!payload.apiKey?.trim()) delete payload.apiKey

      const res = await fetch('/api/chat/config?action=test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload }),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg({ type: 'success', text: '✓ 连接成功' })
      } else {
        setMsg({ type: 'error', text: `✕ ${data.error ?? '连接失败'}` })
      }
    } catch (err) {
      setMsg({ type: 'error', text: `✕ ${String(err)}` })
    } finally {
      setTesting(false)
    }
  }

  // ─── 导出配置 ───
  async function handleExport() {
    try {
      setExporting(true)
      // 使用 export action 获取完整配置（含 apiKey）
      const res = await fetch('/api/chat/config?action=export', { method: 'POST' })
      const data = await res.json()

      // 创建导出数据
      const exportData = {
        version: '1.0',
        exportTime: new Date().toISOString(),
        source: 'Manta AI Models Config',
        ...data,
      }

      // 创建 Blob 并下载
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `manta-ai-models-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setMsg({ type: 'success', text: '配置已导出（含完整 API Key）' })
      setTimeout(() => setMsg(null), 3000)
    } catch {
      setMsg({ type: 'error', text: '导出失败' })
    } finally {
      setExporting(false)
    }
  }

  // ─── 复制单个模型配置 ───
  async function handleCopyProfile(profile: ModelProfileLocal) {
    try {
      setCopiedId(profile.id)
      // 从后端获取完整配置（含 apiKey）
      const res = await fetch('/api/chat/config?action=export', { method: 'POST' })
      const data = await res.json()
      const fullProfile = data.profiles?.find((p: any) => p.id === profile.id)
      if (!fullProfile) {
        setMsg({ type: 'error', text: '获取配置失败' })
        setCopiedId(null)
        return
      }
      // 去掉前端特有的字段
      const { isDefault, ...profileToCopy } = fullProfile
      const jsonStr = JSON.stringify([profileToCopy], null, 2)
      // 写入剪贴板（带降级方案）
      await copyToClipboard(jsonStr)
      setMsg({ type: 'success', text: '配置已复制，可粘贴导入' })
      setTimeout(() => setMsg(null), 3000)
      // 2秒后恢复按钮状态
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      setMsg({ type: 'error', text: `复制失败: ${String(err)}` })
      setCopiedId(null)
    }
  }

  // ─── 剪贴板写入（带降级） ───
  async function copyToClipboard(text: string): Promise<void> {
    // 优先使用现代 API
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch {
        // fallback
      }
    }
    // 降级：使用隐藏 textarea
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '-9999px'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (!ok) throw new Error('复制失败，请手动复制')
  }

  // ─── 触发文件选择 ───
  function triggerImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        setImporting(true)
        const text = await file.text()
        const imported = JSON.parse(text)

        // 验证导入的数据格式
        let profilesToImport: ModelProfileLocal[] = []
        if (imported.profiles && Array.isArray(imported.profiles)) {
          profilesToImport = imported.profiles
        } else if (Array.isArray(imported)) {
          profilesToImport = imported
        } else {
          setMsg({ type: 'error', text: '无效的配置文件格式' })
          return
        }

        // 发送到后端导入
        const res = await fetch('/api/chat/config?action=import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: profilesToImport, merge: true }),
        })
        const data = await res.json()
        if (data.success) {
          setMsg({
            type: 'success',
            text: `导入成功：新增 ${data.added} 个，跳过 ${data.skipped} 个，共 ${data.total} 个配置`,
          })
          await reloadProfiles()
        } else {
          setMsg({ type: 'error', text: data.error ?? '导入失败' })
        }
      } catch {
        setMsg({ type: 'error', text: '解析文件失败，请检查 JSON 格式' })
      } finally {
        setImporting(false)
      }
    }
    input.click()
  }

  // ─── 粘贴导入 ───
  async function handlePasteImport() {
    if (!pasteText.trim()) {
      setMsg({ type: 'error', text: '请先粘贴 JSON 配置内容' })
      return
    }
    try {
      setImporting(true)
      const imported = JSON.parse(pasteText)

      // 验证导入的数据格式
      let profilesToImport: ModelProfileLocal[] = []
      if (imported.profiles && Array.isArray(imported.profiles)) {
        profilesToImport = imported.profiles
      } else if (Array.isArray(imported)) {
        profilesToImport = imported
      } else {
        setMsg({ type: 'error', text: '无效的配置格式' })
        return
      }

      // 发送到后端导入
      const res = await fetch('/api/chat/config?action=import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: profilesToImport, merge: true }),
      })
      const data = await res.json()
      if (data.success) {
        setMsg({
          type: 'success',
          text: `导入成功：新增 ${data.added} 个，跳过 ${data.skipped} 个，共 ${data.total} 个配置`,
        })
        setShowPasteDialog(false)
        setPasteText('')
        await reloadProfiles()
      } else {
        setMsg({ type: 'error', text: data.error ?? '导入失败' })
      }
    } catch {
      setMsg({ type: 'error', text: '解析 JSON 失败，请检查格式' })
    } finally {
      setImporting(false)
    }
  }

  // ─── 重新加载 profiles ───
  async function reloadProfiles() {
    try {
      const res = await fetch('/api/chat/config')
      const data = await res.json()
      const maskedProfiles = data.profilesMasked || []
      setProfiles(maskedProfiles.map((p: ModelProfileLocal) => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        provider: p.provider ?? 'openai',
        apiKey: '',
        baseUrl: p.baseUrl ?? '',
        model: p.model ?? 'gpt-4o-mini',
        temperature: p.temperature ?? 0.7,
        maxTokens: p.maxTokens,
        maxOutputTokens: p.maxOutputTokens,
        maxSteps: p.maxSteps,
        apiKeyMasked: p.apiKeyMasked ?? (p.apiKey === '****' ? '****' : undefined),
      })))
      setActiveProfileId(data.activeProfileId || '')
    } catch {
      // ignore
    }
  }

  // ─── 渲染 ───
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>加载中...</p>
      </div>
    )
  }

  const needsApiKey = editForm?.provider === 'openai' || editForm?.provider === 'openai-compatible'
  const needsBaseUrl = editForm?.provider !== 'openai'

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: '600px' }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
          AI 模型配置
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '24px' }}>
          配置多个 AI 模型，支持 OpenAI API、兼容接口及本地模型服务，可随时切换使用
        </p>

        {/* ── 模型配置列表 ── */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              已配置的模型
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={triggerImport}
                disabled={importing}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: importing ? 'not-allowed' : 'pointer',
                  opacity: importing ? 0.5 : 1,
                }}
              >
                {importing ? '导入中...' : '📁 导入'}
              </button>
              <button
                onClick={() => setShowPasteDialog(true)}
                disabled={importing}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: importing ? 'not-allowed' : 'pointer',
                  opacity: importing ? 0.5 : 1,
                }}
              >
                📋 粘贴
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || profiles.length === 0}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: (exporting || profiles.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (exporting || profiles.length === 0) ? 0.5 : 1,
                }}
              >
                {exporting ? '导出中...' : '📥 导出'}
              </button>
            </div>
          </div>
          {profiles.map((profile) => (
            <div
              key={profile.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                marginBottom: '8px',
                borderRadius: '8px',
                border: `1px solid ${activeProfileId === profile.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: activeProfileId === profile.id ? 'var(--color-accent)10' : 'var(--color-surface)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onClick={() => handleSetActive(profile.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '16px' }}>{PROVIDER_ICON[profile.provider]}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: activeProfileId === profile.id ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {profile.name || profile.model}
                    </span>
                    {profile.isDefault && (
                      <span style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '3px', background: 'var(--color-accent)20', color: 'var(--color-accent)', fontWeight: 600 }}>
                        默认
                      </span>
                    )}
                    {activeProfileId === profile.id && (
                      <span style={{ fontSize: '10px', padding: '1px 4px', borderRadius: '3px', background: '#22c55e20', color: '#22c55e', fontWeight: 600 }}>
                        使用中
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {PROVIDERS.find(p => p.value === profile.provider)?.label ?? profile.provider} · {profile.model}
                    {profile.apiKeyMasked && ` · Key: ${profile.apiKeyMasked}`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {!profile.isDefault && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSetDefault(profile.id) }}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      border: '1px solid var(--color-border)',
                      background: 'transparent',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                    title="设为默认"
                  >
                    ★
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(profile) }}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyProfile(profile) }}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    border: copiedId === profile.id ? '1px solid #22c55e' : '1px solid var(--color-border)',
                    background: copiedId === profile.id ? '#22c55e20' : 'transparent',
                    color: copiedId === profile.id ? '#22c55e' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  title="复制配置（含 API Key）"
                >
                  {copiedId === profile.id ? '✓ 已复制' : '📋'}
                </button>
                {profiles.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(profile.id) }}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      border: '1px solid #ef444440',
                      background: 'transparent',
                      color: '#ef4444',
                      cursor: 'pointer',
                    }}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* 添加按钮 */}
          <button
            onClick={startCreate}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px dashed var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              marginTop: '4px',
            }}
          >
            + 添加模型配置
          </button>
        </div>

        {/* ── 粘贴导入对话框 ── */}
        {showPasteDialog && (
          <div style={{
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--color-accent)',
            background: 'var(--color-surface)',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                粘贴导入配置
              </h3>
              <button
                onClick={() => { setShowPasteDialog(false); setPasteText('') }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '10px' }}>
              粘贴 JSON 配置内容（支持导出文件内容或配置文件中的 profiles 数组）
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder='粘贴 JSON，如：\n{\n  "profiles": [...]\n}\n或直接粘贴数组：\n[...]'
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-primary)',
                fontSize: '12px',
                fontFamily: 'monospace',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
                marginBottom: '12px',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => { setShowPasteDialog(false); setPasteText('') }}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              <button
                onClick={handlePasteImport}
                disabled={importing || !pasteText.trim()}
                style={{
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  border: 'none',
                  background: (importing || !pasteText.trim()) ? 'var(--color-border)' : 'var(--color-accent)',
                  color: '#fff',
                  cursor: (importing || !pasteText.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (importing || !pasteText.trim()) ? 0.5 : 1,
                }}
              >
                {importing ? '导入中...' : '导入'}
              </button>
            </div>
          </div>
        )}

        {/* ── 编辑/新建表单 ── */}
        {(editingId || isCreating) && editForm && (
          <div style={{
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid var(--color-accent)',
            background: 'var(--color-surface)',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {isCreating ? '添加模型配置' : `编辑: ${profiles.find(p => p.id === editingId)?.name || editForm.model}`}
              </h3>
              <button
                onClick={cancelEdit}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  border: '1px solid var(--color-border)',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
            </div>

            {/* 配置名称 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                配置名称
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((p) => p ? { ...p, name: e.target.value } : p)}
                placeholder="如：GPT-4o 日常对话、DeepSeek 代码助手"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Provider 选择 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                模型来源
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {PROVIDERS.map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => handleProviderChange(value)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      textAlign: 'left',
                      border: `1px solid ${editForm.provider === value ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: editForm.provider === value ? 'var(--color-accent)10' : 'var(--color-surface)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: editForm.provider === value ? 600 : 400, color: editForm.provider === value ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            {needsApiKey && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                  API Key
                  {editForm.apiKeyMasked && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>（当前：{editForm.apiKeyMasked}）</span>}
                </label>
                <input
                  type="password"
                  value={editForm.apiKey ?? ''}
                  onChange={(e) => setEditForm((p) => p ? { ...p, apiKey: e.target.value } : p)}
                  placeholder={editForm.apiKeyMasked ? '留空则保持不变' : '输入 API Key'}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Base URL */}
            {needsBaseUrl && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                  API 地址（Base URL）
                </label>
                <input
                  type="text"
                  value={editForm.baseUrl ?? ''}
                  onChange={(e) => setEditForm((p) => p ? { ...p, baseUrl: e.target.value } : p)}
                  placeholder={DEFAULT_BASE_URLS[editForm.provider] ?? 'http://localhost:11434'}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* 模型名称 */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                模型名称
              </label>
              <input
                type="text"
                value={editForm.model}
                onChange={(e) => setEditForm((p) => p ? { ...p, model: e.target.value } : p)}
                placeholder="输入模型名称"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {MODEL_SUGGESTIONS[editForm.provider].map((m) => (
                  <button
                    key={m}
                    onClick={() => setEditForm((p) => p ? { ...p, model: m } : p)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      border: `1px solid ${editForm.model === m ? 'var(--color-accent)' : 'var(--color-border)'}`,
                      background: editForm.model === m ? 'var(--color-accent)15' : 'transparent',
                      color: editForm.model === m ? 'var(--color-accent)' : 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Temperature */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                <span>Temperature（随机性）</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>{editForm.temperature?.toFixed(1) ?? '0.7'}</span>
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={editForm.temperature ?? 0.7}
                onChange={(e) => setEditForm((p) => p ? { ...p, temperature: parseFloat(e.target.value) } : p)}
                style={{ width: '100%', accentColor: 'var(--color-accent)' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                <span>0 — 确定性</span>
                <span>2 — 高随机</span>
              </div>
            </div>

            {/* Agent Loop 限制 */}
            <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--color-surface)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
                Agent Loop 限制
              </div>
              
              {/* 最大输出 Token 预算 */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                  <span>累计输出 Token 预算</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)', fontSize: '11px' }}>
                    {editForm.maxOutputTokens === 0 ? '不限' : (editForm.maxOutputTokens ?? 1_000_000)}
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="100000"
                  value={editForm.maxOutputTokens ?? 1_000_000}
                  onChange={(e) => setEditForm((p) => p ? { ...p, maxOutputTokens: parseInt(e.target.value) || 0 } : p)}
                  placeholder="1000000，0 = 不限"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-primary)',
                    fontSize: '13px',
                  }}
                />
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  累计输出 token 达到上限后停止循环，设为 0 不限制（默认 100 万）
                </div>
              </div>

              {/* 最大步数 */}
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                  <span>最大执行步数</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-text-primary)', fontSize: '11px' }}>
                    {editForm.maxSteps === 0 ? '不限' : (editForm.maxSteps ?? 200)}
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={editForm.maxSteps ?? 200}
                  onChange={(e) => setEditForm((p) => p ? { ...p, maxSteps: parseInt(e.target.value) || 0 } : p)}
                  placeholder="200，0 = 不限"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-primary)',
                    fontSize: '13px',
                  }}
                />
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                  Agent 单次请求最大执行步数，设为 0 不限制（默认 200）
                </div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-inverse)',
                  border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? '保存中...' : (isCreating ? '添加配置' : '保存修改')}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || saving}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 400,
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                  cursor: testing ? 'not-allowed' : 'pointer',
                  opacity: testing ? 0.6 : 1,
                }}
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={cancelEdit}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 400,
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
              >
                取消
              </button>
              {msg && (
                <span style={{ fontSize: '12px', color: msg.type === 'success' ? '#22c55e' : '#ef4444' }}>
                  {msg.text}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── 提示信息 ── */}
        <div style={{ marginTop: '8px', padding: '12px 16px', borderRadius: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', lineHeight: '1.6', margin: 0 }}>
            💡 点击模型卡片即可切换当前使用的模型。点击「使用中」标签旁的配置也可切换。
            <br />配置保存后，在任务页使用 <strong>「新对话」</strong> 按钮创建的会话将使用当前激活的模型；
            <br />环境变量 <code>AI_API_KEY</code>、<code>AI_BASE_URL</code>、<code>AI_MODEL</code> 也可作为默认配置，UI 设置优先级更高。
          </p>
        </div>
      </div>
    </div>
  )
}
/*  end: LLM 配置 Tab */

/* AI end: 设置弹窗 */
