'use client'
import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, Package, BookOpen, FolderOpen, ChevronDown, ChevronUp,
  ExternalLink, Globe, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react'

/* AI start: Skills 页面 — 本地已安装 Skills + 远程 Skills 源配置 */

// ─────────────── 本地 Skills 类型 ───────────────
interface SkillInfo {
  name: string
  description: string
  version: string
  source: 'plugin' | 'personal' | 'project'
  sourcePath: string
  userInvocable: boolean
  hasVersionFile: boolean
  files: string[]
}

interface SkillsApiResponse {
  skills: SkillInfo[]
  stats: { total: number; plugin: number; personal: number; project: number }
  dirs: { plugin: string; personal: string; project: string }
}

// ─────────────── 远程源类型 ───────────────
interface RemoteSkillSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

interface RemoteSkillItem {
  name: string
  description: string
  version?: string
  installCmd?: string
  homepage?: string
  tags?: string[]
}

interface FetchResult {
  sourceId: string
  sourceName: string
  url: string
  status: 'ok' | 'error' | 'disabled'
  skills: RemoteSkillItem[]
  rawTitle?: string
  error?: string
  fetchedAt: string
}

// ─────────────── 本地 Skill 组件 ───────────────

const SOURCE_CONFIG: Record<SkillInfo['source'], { label: string; color: string; bg: string; icon: string }> = {
  plugin: { label: '内置', color: '#63b3ed', bg: '#1e3a5f', icon: '🔧' },
  personal: { label: '个人', color: '#68d391', bg: '#1a3a2a', icon: '👤' },
  project: { label: '项目', color: '#f6ad55', bg: '#3a2a10', icon: '📁' },
}

const SKILL_ICONS: Record<string, string> = {
  help: '📖',
  'skill-manager': '🛠️',
  'find-skills': '🔍',
  'create-subagent': '🤖',
  settings: '⚙️',
}

function SkillCard({ skill }: { skill: SkillInfo }) {
  const [expanded, setExpanded] = useState(false)
  const srcCfg = SOURCE_CONFIG[skill.source]
  const icon = SKILL_ICONS[skill.name] ?? '✨'
  const shortDesc = skill.description.length > 120
    ? skill.description.slice(0, 120) + '…'
    : skill.description

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all"
      style={{ background: '#1a1d2e', border: '1px solid #252836' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: '#0f1117' }}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm">{skill.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: '#0f1117', color: '#8892a4' }}>
                v{skill.version}
              </span>
              {skill.userInvocable && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1a2a3a', color: '#76c7f0' }}>可调用</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: srcCfg.bg, color: srcCfg.color }}>
                {srcCfg.icon} {srcCfg.label}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
          style={{ color: '#4a5568', background: 'transparent' }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: '#8892a4' }}>
        {expanded ? skill.description : shortDesc}
      </p>

      {expanded && (
        <div className="flex flex-col gap-2">
          <div className="p-3 rounded-lg" style={{ background: '#0f1117' }}>
            <div className="text-xs mb-1.5" style={{ color: '#4a5568' }}>文件</div>
            <div className="flex flex-wrap gap-1">
              {skill.files.map(f => (
                <span key={f} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: '#1a1d2e', color: '#a0aec0' }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
          <div
            className="text-xs font-mono truncate px-2 py-1.5 rounded"
            style={{ background: '#0a0d14', color: '#4a5568' }}
            title={skill.sourcePath}
          >
            {skill.sourcePath.replace('/Users/', '~/').replace('/home/', '~/')}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ label, dir }: { label: string; dir: string }) {
  return (
    <div
      className="rounded-xl p-6 flex flex-col items-center gap-2 text-center"
      style={{ background: '#13151f', border: '1px dashed #252836' }}
    >
      <span className="text-2xl opacity-40">📭</span>
      <div className="text-sm" style={{ color: '#4a5568' }}>暂无{label} Skills</div>
      <div className="text-xs font-mono mt-1 px-2 py-1 rounded" style={{ background: '#0f1117', color: '#2d3148' }}>
        {dir.replace('/Users/', '~/').replace('/home/', '~/')}
      </div>
    </div>
  )
}

// ─────────────── 远程 Skill 卡片 ───────────────
/* AI start: 远程 Skill 条目展示卡片 */
function RemoteSkillItem({ item }: { item: RemoteSkillItem }) {
  const [copied, setCopied] = useState(false)
  const cmd = item.installCmd ?? (item.name ? `npx skills add ${item.name}` : '')

  const handleCopy = () => {
    if (!cmd) return
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{ background: '#0f1117', border: '1px solid #1e2130' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">✨</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-white truncate">{item.name}</span>
              {item.version && (
                <span className="text-xs font-mono px-1 py-0.5 rounded" style={{ background: '#1a1d2e', color: '#4a5568' }}>
                  v{item.version}
                </span>
              )}
            </div>
            {item.tags && item.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {item.tags.slice(0, 4).map(t => (
                  <span key={t} className="text-xs px-1 py-0.5 rounded" style={{ background: '#1a2030', color: '#718096' }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {item.homepage && (
          <a
            href={item.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 p-1 rounded"
            style={{ color: '#4a5568' }}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {item.description && (
        <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
          {item.description.slice(0, 150)}{item.description.length > 150 ? '…' : ''}
        </p>
      )}

      {cmd && (
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-mono px-2 py-1.5 rounded w-full text-left transition-colors"
          style={{ background: '#1a1d2e', color: copied ? '#68d391' : '#f6ad55', border: '1px solid #2d3148' }}
        >
          {copied ? <CheckCircle2 size={11} /> : <Package size={11} />}
          {copied ? '已复制！' : cmd}
        </button>
      )}
    </div>
  )
}
/* AI end: 远程 Skill 条目展示卡片 */

// ─────────────── 远程源面板 ───────────────
/* AI start: 远程 Skills 源面板 — 展示源状态、skills 列表，支持刷新 */
function RemoteSourcePanel({
  source,
  onDelete,
  onToggle,
}: {
  source: RemoteSkillSource
  onDelete: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}) {
  const [result, setResult] = useState<FetchResult | null>(null)
  const [fetching, setFetching] = useState(false)
  const [collapsed, setCollapsed] = useState(true) // AI: 默认折叠

  const doFetch = useCallback(async () => {
    if (!source.enabled) return
    setFetching(true)
    try {
      const res = await fetch(`/api/skills/sources/${source.id}/fetch`)
      if (res.ok) setResult(await res.json())
    } finally {
      setFetching(false)
    }
  }, [source.id, source.enabled])

  useEffect(() => {
    if (source.enabled) doFetch()
  }, [doFetch, source.enabled])

  const statusIcon = !source.enabled
    ? null
    : fetching
      ? <Loader2 size={12} className="animate-spin" style={{ color: '#8892a4' }} />
      : result?.status === 'ok'
        ? <CheckCircle2 size={12} style={{ color: '#68d391' }} />
        : result?.status === 'error'
          ? <AlertCircle size={12} style={{ color: '#f87171' }} />
          : null

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid #252836', background: '#13151f' }}
    >
      {/* AI: 源头部 — 点击左侧区域可展开/折叠 */}
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer select-none"
        style={{ background: '#1a1d2e' }}
        onClick={() => setCollapsed(v => !v)}
      >
        <Globe size={14} style={{ color: '#63b3ed', flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{source.name}</span>
            {statusIcon}
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs truncate inline-block max-w-full"
            style={{ color: '#4a5568', textDecoration: 'underline' }}
            onClick={e => e.stopPropagation()}
          >
            {source.url}
          </a>
        </div>

        {/* AI: 操作按钮 — stopPropagation 防止触发展开/折叠 */}
        <div
          className="flex items-center gap-1 flex-shrink-0"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => onToggle(source.id, !source.enabled)}
            className="p-1 rounded transition-colors"
            title={source.enabled ? '禁用' : '启用'}
            style={{ color: source.enabled ? '#68d391' : '#4a5568' }}
          >
            {source.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
          {source.enabled && (
            <button
              onClick={doFetch}
              disabled={fetching}
              className="p-1 rounded"
              title="刷新"
              style={{ color: '#4a5568' }}
            >
              <RefreshCw size={12} className={fetching ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={() => setCollapsed(v => !v)}
            className="p-1 rounded"
            style={{ color: '#4a5568' }}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            onClick={() => onDelete(source.id)}
            className="p-1 rounded"
            title="删除"
            style={{ color: '#4a5568' }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* AI: 内容区 */}
      {!collapsed && (
        <div className="p-4">
          {!source.enabled ? (
            <div className="text-xs text-center py-4" style={{ color: '#4a5568' }}>
              该源已禁用，点击开关启用后自动加载
            </div>
          ) : fetching && !result ? (
            <div className="flex items-center justify-center py-8 gap-2" style={{ color: '#4a5568' }}>
              <Loader2 size={16} className="animate-spin" />
              <span className="text-xs">正在抓取远程数据…</span>
            </div>
          ) : result?.status === 'error' ? (
            <div
              className="flex items-start gap-2 p-3 rounded-lg text-xs"
              style={{ background: '#2d1515', border: '1px solid #5a1a1a', color: '#f87171' }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div className="font-medium mb-0.5">抓取失败</div>
                <div style={{ color: '#fc8181' }}>{result.error}</div>
                <div className="mt-1" style={{ color: '#9b2c2c' }}>
                  可能原因：网络不可达、跨域限制、目标网站结构不支持解析
                </div>
              </div>
            </div>
          ) : result?.skills && result.skills.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs" style={{ color: '#4a5568' }}>
                  共 {result.skills.length} 个 skills
                  {result.rawTitle && ` · ${result.rawTitle}`}
                </span>
                <span className="text-xs" style={{ color: '#2d3148' }}>
                  {new Date(result.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {result.skills.map((item, i) => (
                  <RemoteSkillItem key={`${item.name}-${i}`} item={item} />
                ))}
              </div>
            </>
          ) : result?.status === 'ok' ? (
            <div className="text-xs text-center py-6" style={{ color: '#4a5568' }}>
              <div className="text-lg mb-1">🔍</div>
              未能从该页面解析到 skills 条目
              <div className="mt-1" style={{ color: '#2d3148' }}>
                该网站可能不是标准 skills 注册表，但您仍可直接访问浏览
              </div>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs"
                style={{ color: '#63b3ed' }}
              >
                <ExternalLink size={10} />
                在浏览器中打开
              </a>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
/* AI end: 远程 Skills 源面板 */

// ─────────────── 添加源表单 ───────────────
/* AI start: 添加远程源的表单组件 */
function AddSourceForm({ onAdd }: { onAdd: (name: string, url: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!url.trim()) { setError('请输入 URL'); return }
    let finalUrl = url.trim()
    if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl
    setSubmitting(true)
    try {
      await onAdd(name.trim() || finalUrl, finalUrl)
      setName('')
      setUrl('')
      setOpen(false)
    } catch (e: unknown) {
      setError((e as Error).message || '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-colors w-full"
        style={{ background: '#1a1d2e', border: '1px dashed #2d3148', color: '#63b3ed' }}
      >
        <Plus size={14} />
        添加远程 Skills 源
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: '#1a1d2e', border: '1px solid #2d3a5f' }}
    >
      <div className="text-sm font-medium text-white">添加远程 Skills 源</div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs" style={{ color: '#8892a4' }}>来源名称（可选）</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：我的团队内部源"
          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: '#0f1117', border: '1px solid #2d3148', color: '#e2e8f0', caretColor: '#63b3ed' }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs" style={{ color: '#8892a4' }}>
          网站 URL <span style={{ color: '#f87171' }}>*</span>
        </label>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://skills.sh/ 或 https://example.com/skills"
          autoFocus
          className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
          style={{ background: '#0f1117', border: `1px solid ${error ? '#f87171' : '#2d3148'}`, color: '#e2e8f0', caretColor: '#63b3ed' }}
        />
        {error && <span className="text-xs" style={{ color: '#f87171' }}>{error}</span>}
      </div>

      <div className="text-xs leading-relaxed p-2 rounded" style={{ background: '#0a0d14', color: '#4a5568' }}>
        💡 支持任意 URL：JSON 注册表 API、HTML 页面均可。ARM 会尝试解析 skills 列表。
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#1e3a5f', border: '1px solid #2d4a7a', color: '#63b3ed' }}
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          {submitting ? '添加中…' : '添加'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError('') }}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#8892a4' }}
        >
          取消
        </button>
      </div>
    </form>
  )
}
/* AI end: 添加远程源的表单组件 */

// ─────────────── 主页面 ───────────────
export default function SkillsPage() {
  // AI: 本地 skills 状态
  const [data, setData] = useState<SkillsApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'plugin' | 'personal' | 'project' | 'remote'>('all')

  // AI: 远程源状态
  const [sources, setSources] = useState<RemoteSkillSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)

  const fetchSkills = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/skills')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }

  const fetchSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const res = await fetch('/api/skills/sources')
      if (res.ok) {
        const d = await res.json()
        setSources(d.sources ?? [])
      }
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  useEffect(() => { fetchSkills() }, [])
  useEffect(() => { fetchSources() }, [fetchSources])

  // AI: 添加远程源
  const handleAddSource = async (name: string, url: string) => {
    const res = await fetch('/api/skills/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    })
    if (!res.ok) throw new Error('添加失败')
    await fetchSources()
  }

  // AI: 删除远程源
  const handleDeleteSource = async (id: string) => {
    await fetch(`/api/skills/sources/${id}`, { method: 'DELETE' })
    setSources(s => s.filter(x => x.id !== id))
  }

  // AI: 切换远程源 enabled
  const handleToggleSource = async (id: string, enabled: boolean) => {
    const res = await fetch(`/api/skills/sources/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      setSources(s => s.map(x => x.id === id ? { ...x, enabled } : x))
    }
  }

  const filteredSkills = data?.skills.filter(s =>
    activeTab === 'all' || activeTab === 'remote' ? (activeTab === 'all') : s.source === activeTab
  ) ?? []
  // AI: all tab 下展示所有本地 skills
  const localFilteredSkills = activeTab === 'all'
    ? (data?.skills ?? [])
    : (activeTab === 'remote' ? [] : (data?.skills.filter(s => s.source === activeTab) ?? []))

  const tabs = [
    { key: 'all' as const, label: '全部', count: data?.stats.total ?? 0 },
    { key: 'plugin' as const, label: '内置', count: data?.stats.plugin ?? 0 },
    { key: 'personal' as const, label: '个人', count: data?.stats.personal ?? 0 },
    { key: 'project' as const, label: '项目', count: data?.stats.project ?? 0 },
    { key: 'remote' as const, label: '🌐 远程源', count: sources.length },
  ]

  return (
    <div className="flex flex-col h-screen">
      {/* AI: 顶部标题栏 */}
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Package size={18} style={{ color: '#63b3ed' }} />
            Skills
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>
            {data
              ? `已安装 ${data.stats.total} 个 · 内置 ${data.stats.plugin} · 个人 ${data.stats.personal} · 项目 ${data.stats.project}`
              : 'CodeFlicker 本机已安装的技能包'}
            {sources.length > 0 && ` · 远程源 ${sources.length} 个`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://skills.sh/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
          >
            <ExternalLink size={11} />
            Skills 市场
          </a>
          <button
            onClick={() => { fetchSkills(); if (activeTab === 'remote') fetchSources() }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* AI: Tab 筛选栏 */}
      <div
        className="px-6 flex items-center gap-1 border-b"
        style={{ borderColor: '#2d3148', background: '#13151f' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px"
            style={{
              borderColor: activeTab === tab.key ? (tab.key === 'remote' ? '#a78bfa' : '#63b3ed') : 'transparent',
              color: activeTab === tab.key ? (tab.key === 'remote' ? '#a78bfa' : '#63b3ed') : '#4a5568',
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="px-1.5 py-0.5 rounded-full text-xs"
                style={{
                  background: activeTab === tab.key
                    ? (tab.key === 'remote' ? '#2d1a5f' : '#1e3a5f')
                    : '#1e2130',
                  color: activeTab === tab.key
                    ? (tab.key === 'remote' ? '#a78bfa' : '#63b3ed')
                    : '#4a5568',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* AI: 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── 本地 Skills ── */}
        {activeTab !== 'remote' && (
          <>
            {loading && !data ? (
              <div className="flex items-center justify-center py-20">
                <RefreshCw size={20} className="animate-spin" style={{ color: '#4a5568' }} />
              </div>
            ) : (
              <>
                {localFilteredSkills.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {localFilteredSkills.map(skill => (
                      <SkillCard key={`${skill.source}-${skill.name}`} skill={skill} />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(activeTab === 'all' || activeTab === 'personal') && (
                      <div className="mb-6">
                        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>
                          👤 个人 Skills
                        </h2>
                        <EmptyState label="个人" dir={data?.dirs.personal ?? '~/.codeflicker/skills/'} />
                      </div>
                    )}
                    {(activeTab === 'all' || activeTab === 'project') && (
                      <div>
                        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4a5568' }}>
                          📁 项目 Skills
                        </h2>
                        <EmptyState label="项目" dir={data?.dirs.project ?? '.codeflicker/skills/'} />
                      </div>
                    )}
                  </div>
                )}

                {data && data.stats.personal === 0 && data.stats.project === 0 && activeTab !== 'plugin' && (
                  <div
                    className="mt-6 p-4 rounded-xl flex items-start gap-3"
                    style={{ background: '#13151f', border: '1px solid #1e2130' }}
                  >
                    <BookOpen size={16} style={{ color: '#63b3ed', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div className="text-sm font-medium text-white mb-1">安装更多 Skills</div>
                      <div className="text-xs leading-relaxed" style={{ color: '#8892a4' }}>
                        使用{' '}
                        <code className="px-1 py-0.5 rounded text-xs font-mono" style={{ background: '#0f1117', color: '#f6ad55' }}>
                          npx skills add &lt;package&gt;
                        </code>
                        {' '}安装来自{' '}
                        <a
                          href="https://skills.sh/"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#63b3ed', textDecoration: 'underline' }}
                        >
                          skills.sh
                        </a>{' '}
                        的第三方 Skills，或前往「🌐 远程源」Tab 浏览。
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {['~/.codeflicker/skills/  (个人级)', '.codeflicker/skills/  (项目级)'].map(d => (
                          <span key={d} className="text-xs font-mono px-2 py-1 rounded" style={{ background: '#0f1117', color: '#4a5568' }}>
                            <FolderOpen size={10} className="inline mr-1" />
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── 远程源 Tab ── */}
        {activeTab === 'remote' && (
          <div className="flex flex-col gap-4">
            {/* AI: 说明头部 */}
            <div
              className="p-4 rounded-xl flex items-start gap-3"
              style={{ background: '#13151f', border: '1px solid #1e2130' }}
            >
              <Globe size={16} style={{ color: '#a78bfa', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div className="text-sm font-medium text-white mb-1">远程 Skills 源</div>
                <div className="text-xs leading-relaxed" style={{ color: '#8892a4' }}>
                  配置任意 skills 网站 URL，ARM 将自动抓取并解析 skills 列表。
                  支持 <span style={{ color: '#f6ad55' }}>JSON 注册表 API</span>（如自托管的 skills registry）
                  和 <span style={{ color: '#f6ad55' }}>HTML 页面</span>（如 skills.sh）。
                  配置持久化至 <code className="font-mono px-1 rounded" style={{ background: '#0f1117', color: '#63b3ed' }}>config/skills-sources.yaml</code>。
                </div>
              </div>
            </div>

            {/* AI: 添加源表单 */}
            <AddSourceForm onAdd={handleAddSource} />

            {/* AI: 源列表 */}
            {sourcesLoading && sources.length === 0 ? (
              <div className="flex items-center justify-center py-10 gap-2" style={{ color: '#4a5568' }}>
                <Loader2 size={16} className="animate-spin" />
                <span className="text-xs">加载远程源配置…</span>
              </div>
            ) : sources.length > 0 ? (
              <div className="flex flex-col gap-4">
                {sources.map(source => (
                  <RemoteSourcePanel
                    key={source.id}
                    source={source}
                    onDelete={handleDeleteSource}
                    onToggle={handleToggleSource}
                  />
                ))}
              </div>
            ) : (
              <div
                className="rounded-xl p-8 flex flex-col items-center gap-3 text-center"
                style={{ background: '#13151f', border: '1px dashed #2d3148' }}
              >
                <Globe size={32} style={{ color: '#2d3148' }} />
                <div className="text-sm font-medium" style={{ color: '#4a5568' }}>暂无远程源配置</div>
                <div className="text-xs" style={{ color: '#2d3148' }}>
                  点击上方「添加远程 Skills 源」按钮添加您的第一个远程源
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
/* AI end: Skills 页面 */
