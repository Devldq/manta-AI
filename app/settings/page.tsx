/*  start: Manta 设置页 — Runner 探测状态 + Webhook Channel 配置 */
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

  useEffect(() => {
    probeRunners()
    // AI: 从 localStorage 读取 Webhook 配置（MVP 简单存法）
    const saved = localStorage.getItem('manta:webhook')
    if (saved) {
      try {
        setWebhook(JSON.parse(saved))
      } catch {}
    }
  }, [])

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
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">系统设置</h1>
        <p className="mt-1 text-sm text-text-muted">Runner 状态探测 · Channel 配置 · 系统信息</p>
      </div>

      {/* Runner 状态 */}
      <section className="mb-10">
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
      <section className="mb-10">
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

      {/* 系统信息 */}
      <section>
        <h2 className="text-sm font-medium text-text-primary mb-4">系统信息</h2>
        <div className="border border-border rounded-lg divide-y divide-border-subtle">
          <InfoRow label="版本" value="Manta v2.0.0" />
          <InfoRow label="分支" value="v2manta" />
          <InfoRow label="数据目录" value="~/arm-data/" />
          <InfoRow label="Agent 注册表" value="~/arm-data/registry/agents.yaml" />
          <InfoRow label="任务存储" value="~/arm-data/tasks.json" />
        </div>
      </section>
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
