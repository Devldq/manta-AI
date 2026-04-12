/* AI start: Manta 设置页 — Runner 探测 + Webhook + 插件管理 + 系统信息 */
'use client'

import { useState, useEffect } from 'react'
import React from 'react'
import Link from 'next/link'

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
/* AI end: 插件 manifest 类型 */

// AI: 目录项
const TOC = [
  { id: 'section-about', label: '系统介绍' },
  { id: 'section-runner', label: 'Runner 状态' },
  { id: 'section-webhook', label: 'Webhook 通知' },
  { id: 'section-plugins', label: '插件管理' },
  { id: 'section-sysinfo', label: '系统信息' },
]

export default function SettingsPage() {
  const [readme, setReadme] = useState<string>('')
  const [readmeLoading, setReadmeLoading] = useState(true)
  const [runners, setRunners] = useState<RunnerStatus[]>([])
  const [runnerLoading, setRunnerLoading] = useState(false)
  const [webhook, setWebhook] = useState<WebhookConfig>({
    url: '',
    type: 'feishu',
    enabled: false,
  })
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookSaved, setWebhookSaved] = useState(false)
  const [plugins, setPlugins] = useState<PluginManifest[]>([])
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [installPkg, setInstallPkg] = useState('')
  const [installState, setInstallState] = useState<'idle' | 'installing' | 'success' | 'error'>('idle')
  const [installMsg, setInstallMsg] = useState('')
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    const api = (window as Window & { electronAPI?: { selectDirectory?: unknown } }).electronAPI
    setIsElectron(typeof api?.selectDirectory === 'function')
    probeRunners()
    loadPlugins()
    const saved = localStorage.getItem('manta:webhook')
    if (saved) {
      try { setWebhook(JSON.parse(saved)) } catch {}
    }
    // AI: 加载 README
    fetch('/api/readme')
      .then((r) => r.json())
      .then((d) => setReadme(d.content ?? ''))
      .catch(() => setReadme('README.md 加载失败'))
      .finally(() => setReadmeLoading(false))
  }, [])

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
    <div className="flex min-h-full" style={{ background: 'var(--color-background)' }}>
      {/* AI: 左侧目录导航 */}
      <nav className="w-44 flex-shrink-0 sticky top-0 self-start pt-8 pl-6 pr-4 hidden md:block">
        <p style={{ color: 'var(--color-text-muted)', fontSize: '11px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
          目录
        </p>
        <ul className="space-y-1" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {TOC.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: '13px', padding: '4px 0', textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
              >
                {item.label}
              </a>
            </li>
          ))}
          {/* AI: 快速跳转到主题设置 */}
          <li style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--color-border)' }}>
            <Link
              href="/themes"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-accent)', fontSize: '13px', textDecoration: 'none', fontWeight: 500 }}
            >
              <span>◐</span>
              <span>主题设置</span>
            </Link>
          </li>
        </ul>
      </nav>

      <div className="flex-1 p-8 max-w-2xl">
        {/* Header */}
        <div className="mb-10">
          <h1 style={{ fontSize: '22px', fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.4px', margin: 0 }}>
            系统设置
          </h1>
          <p style={{ marginTop: '4px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Runner 状态探测 · Channel 配置 · 插件管理 · 系统信息
          </p>
        </div>

        {/* ─── 系统介绍 ─── */}
        <section id="section-about" className="mb-10 scroll-mt-8">
          <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 12px' }}>
            系统介绍
          </h2>
          <div
            className="rounded-lg overflow-auto"
            style={{
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              maxHeight: '480px',
            }}
          >
            {readmeLoading ? (
              <div className="p-6" style={{ color: 'var(--color-text-muted)', fontSize: '13px' }}>加载中...</div>
            ) : (
              <MarkdownView content={readme} />
            )}
          </div>
        </section>

        {/* ─── Runner 状态 ─── */}
        <section id="section-runner" className="mb-10 scroll-mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
              Runner 状态
            </h2>
            <button
              onClick={probeRunners}
              disabled={runnerLoading}
              style={{
                fontSize: '12px',
                padding: '5px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
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
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>点击"重新探测"检查 Runner 可用性</p>
          )}

          <div className="space-y-2">
            {runners.map((runner) => (
              <RunnerCard key={runner.id} runner={runner} />
            ))}
          </div>

          <div
            className="mt-4 p-4 rounded-lg"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              如何安装 Runner
            </p>
            <div className="space-y-1.5" style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
              <div>openclaw: <span style={{ color: 'var(--color-text-secondary)' }}>brew install openclaw</span></div>
              <div>claude code: <span style={{ color: 'var(--color-text-secondary)' }}>npm install -g @anthropic-ai/claude-code</span></div>
              <div>generic-cli: <span style={{ color: 'var(--color-text-secondary)' }}>在 Agent 管理页配置 bin 路径</span></div>
            </div>
          </div>
        </section>

        {/* ─── Webhook 通知 ─── */}
        <section id="section-webhook" className="mb-10 scroll-mt-8">
          <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>
            Webhook 通知
          </h2>
          <div
            className="rounded-lg p-5 space-y-4"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>启用 Webhook</p>
                <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>任务状态变化时推送通知</p>
              </div>
              <ToggleSwitch
                enabled={webhook.enabled}
                onChange={(v) => setWebhook({ ...webhook, enabled: v })}
              />
            </div>

            {webhook.enabled && (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    平台类型
                  </label>
                  <select
                    value={webhook.type}
                    onChange={(e) => setWebhook({ ...webhook, type: e.target.value as WebhookConfig['type'] })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
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
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                    Webhook URL
                  </label>
                  <input
                    type="text"
                    value={webhook.url}
                    onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '14px',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end">
              <button
                onClick={saveWebhook}
                disabled={webhookSaving}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-inverse)',
                  borderRadius: 'var(--radius-md)',
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
        <section id="section-plugins" className="mb-10 scroll-mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: 0 }}>
              已安装插件
            </h2>
            <button
              onClick={loadPlugins}
              disabled={pluginsLoading}
              style={{
                fontSize: '12px',
                padding: '5px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-secondary)',
                background: 'transparent',
                cursor: 'pointer',
                opacity: pluginsLoading ? 0.5 : 1,
              }}
            >
              {pluginsLoading ? '加载中...' : '刷新'}
            </button>
          </div>

          {/* AI: 安装新插件 */}
          <div
            className="rounded-lg p-4 mb-4"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '12px' }}>
              安装插件（选择本地插件目录）
            </p>
            <div className="flex gap-2">
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
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
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
                  padding: '8px 12px',
                  fontSize: '14px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
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
                  padding: '8px 16px',
                  fontSize: '13px',
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-inverse)',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  opacity: (installState === 'installing' || !installPkg.trim()) ? 0.5 : 1,
                }}
              >
                {installState === 'installing' ? '安装中...' : '安装'}
              </button>
            </div>
            <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
              插件目录内须包含 <code style={{ fontFamily: 'var(--font-mono)' }}>plugin.yaml</code> 文件
            </p>
            {installMsg && (
              <p
                style={{
                  marginTop: '6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: installState === 'success' ? 'var(--color-status-done)' : 'var(--color-status-failed)',
                }}
              >
                {installMsg}
              </p>
            )}
          </div>

          {plugins.length === 0 && !pluginsLoading && (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>未发现插件</p>
          )}

          <div className="space-y-2">
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
                onUninstall={uninstallPlugin}
              />
            ))}
          </div>
        </section>

        {/* ─── 系统信息 ─── */}
        <section id="section-sysinfo" className="scroll-mt-8">
          <h2 style={{ fontSize: '14px', fontWeight: 500, color: 'var(--color-text-primary)', margin: '0 0 16px' }}>
            系统信息
          </h2>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--color-border)' }}
          >
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
    <div
      className="rounded-lg p-3 flex items-center gap-3"
      style={{
        border: `1px solid ${runner.available ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
        background: runner.available ? 'var(--color-surface)' : 'var(--color-background)',
      }}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: runner.available ? 'var(--color-status-done)' : 'var(--color-status-failed)' }}
      />
      <div className="flex-1 min-w-0">
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
          {runner.id}
        </span>
        {runner.version && (
          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--color-text-muted)' }}>{runner.version}</span>
        )}
        {!runner.available && runner.reason && (
          <p style={{ fontSize: '11px', color: 'var(--color-status-failed)', marginTop: '2px' }}>{runner.reason}</p>
        )}
      </div>
      <span
        style={{
          fontSize: '11px',
          color: runner.available ? 'var(--color-status-done)' : 'var(--color-status-failed)',
        }}
      >
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

/* AI start: 插件卡片 */
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
    <div
      className="rounded-lg p-4"
      style={{
        border: `1px solid ${plugin.disabled ? 'var(--color-border-subtle)' : 'var(--color-border)'}`,
        background: plugin.disabled ? 'var(--color-background)' : 'var(--color-surface)',
        opacity: plugin.disabled ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {plugin.name}
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-background)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {FORMAT_LABEL[plugin.agentFormat] ?? plugin.agentFormat}
            </span>
            {plugin.isNpm && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-background)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-muted)',
                }}
              >
                npm
              </span>
            )}
            {plugin.disabled && (
              <span
                style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-background)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-status-failed)',
                }}
              >
                已禁用
              </span>
            )}
          </div>
          {plugin.description && (
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>{plugin.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
            <span>id: {plugin.id}</span>
            <span>runner: {plugin.runnerId}</span>
            {plugin.openclawConfigFile && <span>config: {plugin.openclawConfigFile}</span>}
            {plugin.agentsDirs && plugin.agentsDirs.length > 0 && (
              <span>dirs: {plugin.agentsDirs.join(', ')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <ToggleSwitch
            enabled={!plugin.disabled}
            onChange={(enabled) => onToggle(plugin.id, !enabled)}
          />
          {plugin.isNpm && (
            <button
              onClick={handleUninstall}
              disabled={uninstalling}
              style={{
                fontSize: '12px',
                padding: '5px 10px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
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

// AI: 信息行
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
    >
      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

/* AI start: 简易 Markdown 渲染组件（无第三方依赖，纯 CSS + 正则转换） */
function MarkdownView({ content }: { content: string }) {
  // AI: 把 markdown 文本逐行转为带样式的 HTML 片段
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''

  function flushCode() {
    if (codeLines.length === 0) return
    elements.push(
      <pre
        key={`code-${elements.length}`}
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-secondary)',
          overflowX: 'auto',
          margin: '8px 0',
          lineHeight: 1.6,
        }}
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
    codeLines = []
    codeLang = ''
  }

  // AI: 内联样式：**bold**、`code`、[text](url)
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
        parts.push(
          <code key={idx++} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--color-background)', padding: '1px 4px', borderRadius: '3px', color: 'var(--color-accent)' }}>
            {token.slice(1, -1)}
          </code>
        )
      } else if (token.startsWith('**')) {
        parts.push(<strong key={idx++} style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{token.slice(2, -2)}</strong>)
      } else if (token.startsWith('*')) {
        parts.push(<em key={idx++}>{token.slice(1, -1)}</em>)
      } else {
        const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/)
        if (linkMatch) {
          parts.push(
            <a key={idx++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>
              {linkMatch[1]}
            </a>
          )
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
      if (inCodeBlock) {
        flushCode()
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '16px 0 6px', letterSpacing: '-0.2px' }}>{renderInline(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', margin: '20px 0 8px', paddingBottom: '6px', borderBottom: '1px solid var(--color-border)', letterSpacing: '-0.3px' }}>{renderInline(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={i} style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-text-primary)', margin: '0 0 12px', letterSpacing: '-0.5px' }}>{renderInline(line.slice(2))}</h1>)
    } else if (/^[-*] /.test(line)) {
      elements.push(<li key={i} style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginLeft: '16px', listStyleType: 'disc' }}>{renderInline(line.slice(2))}</li>)
    } else if (/^\d+\. /.test(line)) {
      elements.push(<li key={i} style={{ fontSize: '13px', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginLeft: '16px', listStyleType: 'decimal' }}>{renderInline(line.replace(/^\d+\. /, ''))}</li>)
    } else if (line.startsWith('|')) {
      // AI: 简单表格 — 跳过分隔行
      if (/^\|[-| :]+\|$/.test(line)) continue
      const cells = line.split('|').filter((_, ci) => ci > 0 && ci < line.split('|').length - 1)
      const isHeader = i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1])
      elements.push(
        <div key={i} style={{ display: 'flex', borderBottom: '1px solid var(--color-border-subtle)' }}>
          {cells.map((cell, ci) => (
            <div key={ci} style={{
              flex: 1,
              padding: '5px 10px',
              fontSize: '12px',
              color: isHeader ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: isHeader ? 600 : 400,
              background: isHeader ? 'var(--color-background)' : 'transparent',
            }}>
              {renderInline(cell.trim())}
            </div>
          ))}
        </div>
      )
    } else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '12px', margin: '8px 0', color: 'var(--color-text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
          {renderInline(line.slice(2))}
        </blockquote>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: '6px' }} />)
    } else {
      elements.push(<p key={i} style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '4px 0', lineHeight: 1.65 }}>{renderInline(line)}</p>)
    }
  }

  if (inCodeBlock) flushCode()

  return (
    <div className="p-6" style={{ minHeight: '60px' }}>
      {elements}
    </div>
  )
}
/* AI end: MarkdownView */

/* AI end: 设置页 */
