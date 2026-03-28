/*  start: Manta 设置页 — Runner 探测状态 + Webhook Channel 配置 + 插件管理 */
'use client'

import { useState, useEffect } from 'react'

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

  useEffect(() => {
    const api = (window as Window & { electronAPI?: { selectDirectory?: unknown } }).electronAPI
    setIsElectron(typeof api?.selectDirectory === 'function')
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
      const api = (window as Window & { electronAPI: { selectDirectory: () => Promise<string | null> } }).electronAPI
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
        <p className="mt-1 text-sm text-text-muted">Runner 状态探测 · Channel 配置 · 插件管理 · 系统信息</p>
      </div>

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
/*  end: 设置页结束 */
