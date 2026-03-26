'use client'
import { useEffect, useState } from 'react'
import type { ArmConfig, TriggerMode } from '@/config/arm'

/* AI start: ARM 触发配置管理页面 — 支持本地 CLI 和 IM 两种触发模式 */

const IM_CHANNELS = ['kim', 'feishu', 'telegram', 'whatsapp', 'discord', 'slack', 'lark']
const ARM_AGENTS = ['arm-architect', 'arm-dev', 'arm-qa', 'arm-review']

export default function SettingsPage() {
  const [config, setConfig] = useState<ArmConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/settings/arm')
      .then(r => r.json())
      .then(setConfig)
      .catch(() => setError('配置加载失败'))
  }, [])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/settings/arm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ color: '#8892a4' }}>
        {error || '加载中...'}
      </div>
    )
  }

  const setMode = (mode: TriggerMode) => setConfig(c => c ? { ...c, trigger_mode: mode } : c)
  const setImField = (field: string, val: string) =>
    setConfig(c => c ? { ...c, im: { ...c.im, [field]: val } } : c)
  const setImTarget = (agentId: string, val: string) =>
    setConfig(c => c ? { ...c, im: { ...c.im, targets: { ...c.im.targets, [agentId]: val } } } : c)
  const setLocalField = (field: string, val: string | number) =>
    setConfig(c => c ? { ...c, local: { ...c.local, [field]: val } } : c)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* AI: 页面标题 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">⚙️ ARM 触发配置</h1>
        <p className="text-xs mt-1" style={{ color: '#8892a4' }}>
          配置 Agent 触发方式。修改保存后立即生效，无需重启。
        </p>
      </div>

      {/* AI: 触发模式选择 */}
      <section className="rounded-xl p-5 mb-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
        <h2 className="text-sm font-semibold text-white mb-3">触发模式</h2>
        <div className="flex gap-3">
          {(['local', 'im'] as TriggerMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              className="flex-1 py-3 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: config.trigger_mode === mode ? '#3b82f6' : '#0f1117',
                color: config.trigger_mode === mode ? '#fff' : '#8892a4',
                border: `1px solid ${config.trigger_mode === mode ? '#3b82f6' : '#2d3148'}`,
              }}
            >
              {mode === 'local' ? '🖥  本地 CLI（默认）' : '📡  IM Channel（跨机器）'}
            </button>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: '#4a5568' }}>
          {config.trigger_mode === 'local'
            ? '通过本机 openclaw CLI 直接调用 agent，零配置开箱即用。'
            : '通过 IM 消息触发远端机器上的 OpenClaw agent，适用于 ARM 和 OpenClaw 不在同一台机器的场景。'}
        </p>
      </section>

      {/* AI: 本地 CLI 配置（local 模式时显示） */}
      {config.trigger_mode === 'local' && (
        <section className="rounded-xl p-5 mb-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
          <h2 className="text-sm font-semibold text-white mb-3">本地 CLI 配置</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>
                openclaw 路径
                <span className="ml-1" style={{ color: '#4a5568' }}>（留空则从 PATH 自动查找）</span>
              </label>
              <input
                value={config.local.openclaw_bin}
                onChange={e => setLocalField('openclaw_bin', e.target.value)}
                placeholder="~/.openclaw/bin/openclaw"
                className="w-full px-3 py-2 rounded-lg text-sm text-white font-mono"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>触发超时（秒）</label>
              <input
                type="number"
                value={config.local.timeout}
                onChange={e => setLocalField('timeout', parseInt(e.target.value) || 600)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              />
            </div>
          </div>
        </section>
      )}

      {/* AI: IM 配置（im 模式时显示） */}
      {config.trigger_mode === 'im' && (
        <section className="rounded-xl p-5 mb-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
          <h2 className="text-sm font-semibold text-white mb-3">IM Channel 配置</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#8892a4' }}>IM 类型</label>
              <select
                value={config.im.channel}
                onChange={e => setImField('channel', e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#0f1117', border: '1px solid #2d3148' }}
              >
                {IM_CHANNELS.map(ch => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-2" style={{ color: '#8892a4' }}>
                Agent 联系人映射
                <span className="ml-1" style={{ color: '#4a5568' }}>（对应远端机器 OpenClaw 的 IM 身份）</span>
              </label>
              <div className="space-y-2">
                {ARM_AGENTS.map(agentId => (
                  <div key={agentId} className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono px-2 py-1 rounded w-36 flex-shrink-0 text-center"
                      style={{ background: '#252a3a', color: '#8892a4' }}
                    >
                      {agentId}
                    </span>
                    <input
                      value={config.im.targets[agentId] ?? ''}
                      onChange={e => setImTarget(agentId, e.target.value)}
                      placeholder={config.im.channel === 'feishu' ? 'ou_xxx 或 open_id' : config.im.channel === 'kim' ? '@username' : 'target ID'}
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm text-white font-mono"
                      style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* AI: 保存按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: '#3b82f6' }}
        >
          {saving ? '保存中...' : saved ? '✅ 已保存' : '保存配置'}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
        <span className="text-xs ml-auto" style={{ color: '#4a5568' }}>
          配置文件：config/arm.yaml · 修改即生效
        </span>
      </div>
    </div>
  )
}
/* AI end: ARM 触发配置管理页面 */
