/* 应用搭建器 — /apps/:id/builder */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Send, Eye } from 'lucide-react'
import type { AppConfig, AppStatus } from '@manta/shared'
import { useAppStore } from '@/stores/app-store'
import { SkeletonDetailPage } from '@/components/skeleton'

const TABS = [
  { id: 'basic', label: '基础信息', icon: '📋' },
  { id: 'agent', label: 'Agent 配置', icon: '🤖' },
  { id: 'rag', label: '知识库', icon: '📚' },
  { id: 'tools', label: '工具', icon: '🛠️' },
  { id: 'automation', label: '自动化', icon: '⚡' },
  { id: 'preview', label: '预览', icon: '👁️' },
]

export default function AppBuilderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { apps, updateApp, changeStatus, fetchApps } = useAppStore()

  const [app, setApp] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
  const [dirty, setDirty] = useState(false)

  // 表单状态
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('🤖')
  const [tags, setTags] = useState('')
  const [agentId, setAgentId] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.7)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/apps/${id}`)
        const data = await res.json()
        if (data.app) {
          setApp(data.app)
          setName(data.app.name)
          setDescription(data.app.description)
          setIcon(data.app.icon)
          setTags(data.app.tags.join(', '))
          setAgentId(data.app.agentId)
          setSystemPrompt(data.app.agentOverride?.systemPrompt ?? '')
          setTemperature(data.app.agentOverride?.temperature ?? 0.7)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  // 离开前未保存提示
  useEffect(() => {
    if (!dirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  async function handleSave(status?: AppStatus) {
    if (!app) return
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim(),
        icon,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        agentId: agentId.trim(),
        agentOverride: {
          systemPrompt: systemPrompt.trim() || undefined,
          temperature,
        },
      }
      if (status) {
        patch.status = status
      }
      await updateApp(id!, patch as any)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    await handleSave('published' as AppStatus)
    if (app) {
      await changeStatus(id!, 'published')
    }
    setDirty(false)
  }

  function markDirty() {
    setDirty(true)
  }

  if (loading) {
    return <SkeletonDetailPage showSidebar sidebarWidth="320px" />
  }

  if (!app) {
    return (
      <div className="p-8 text-center">
        <p style={{ color: 'var(--color-text-secondary)' }}>应用不存在</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 顶部栏 */}
      <div
        className="flex items-center gap-3 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <button
          onClick={() => navigate('/apps')}
          className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>/</span>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          应用搭建器
        </span>
        <span style={{ color: 'var(--color-text-muted)' }}>/</span>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {app.name}
        </span>

        <span
          className="text-xs px-2 py-0.5 rounded ml-2"
          style={{
            background:
              app.status === 'draft'
                ? 'rgba(212, 160, 23, 0.15)'
                : app.status === 'published'
                ? 'rgba(14, 158, 106, 0.15)'
                : 'rgba(107, 114, 128, 0.15)',
            color:
              app.status === 'draft'
                ? '#d4a017'
                : app.status === 'published'
                ? '#0e9e6a'
                : '#6b7280',
          }}
        >
          {app.status === 'draft' ? '草稿' : app.status === 'published' ? '已发布' : '已归档'}
        </span>
        {dirty && (
          <span className="text-xs" style={{ color: '#d4a017' }}>
            未保存更改
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            opacity: saving ? 0.5 : 1,
          }}
        >
          <Save size={14} />
          {saving ? '保存中...' : '保存草稿'}
        </button>
        <button
          onClick={handlePublish}
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
            opacity: saving || !name.trim() ? 0.5 : 1,
          }}
        >
          <Send size={14} />
          发布
        </button>
      </div>

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧 Tab */}
        <div
          className="w-48 flex-shrink-0 p-3 flex flex-col gap-0.5"
          style={{ borderRight: '1px solid var(--color-border)' }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-all"
              style={{
                background:
                  activeTab === tab.id ? 'var(--color-accent-subtle)' : 'transparent',
                color:
                  activeTab === tab.id
                    ? 'var(--color-accent)'
                    : 'var(--color-text-secondary)',
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 右侧内容 + 预览 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 配置表单 */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === 'basic' && (
              <div className="max-w-lg space-y-4">
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  基础信息
                </h2>
                <FormField label="应用名称" required>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); markDirty() }}
                    placeholder="输入应用名称"
                    maxLength={30}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </FormField>
                <FormField label="描述">
                  <textarea
                    value={description}
                    onChange={(e) => { setDescription(e.target.value); markDirty() }}
                    placeholder="简要描述应用的用途"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </FormField>
                <FormField label="图标">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={icon}
                      onChange={(e) => { setIcon(e.target.value); markDirty() }}
                      maxLength={4}
                      className="w-16 px-2 py-2 rounded-lg text-center text-lg outline-none"
                      style={{
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      输入 emoji，如 🤖 📄 📋
                    </span>
                  </div>
                </FormField>
                <FormField label="标签">
                  <input
                    type="text"
                    value={tags}
                    onChange={(e) => { setTags(e.target.value); markDirty() }}
                    placeholder="用逗号分隔，如：简历, 招聘, HR"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </FormField>
              </div>
            )}

            {activeTab === 'agent' && (
              <div className="max-w-lg space-y-4">
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  Agent 配置
                </h2>
                <FormField label="选择 Agent">
                  <input
                    type="text"
                    value={agentId}
                    onChange={(e) => { setAgentId(e.target.value); markDirty() }}
                    placeholder="从注册表中选择 Agent"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </FormField>
                <FormField label="System Prompt (覆盖)">
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => { setSystemPrompt(e.target.value); markDirty() }}
                    placeholder="自定义 system prompt，留空使用 Agent 默认的..."
                    rows={8}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none font-mono"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-primary)',
                    }}
                  />
                </FormField>
                <FormField label={`Temperature: ${temperature}`}>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => { setTemperature(Number(e.target.value)); markDirty() }}
                    className="w-full"
                    style={{ accentColor: 'var(--color-accent)' }}
                  />
                  <div className="flex justify-between text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span>0 (精确)</span>
                    <span>1</span>
                    <span>2 (随机)</span>
                  </div>
                </FormField>
              </div>
            )}

            {activeTab === 'rag' && (
              <div className="max-w-lg">
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  知识库配置
                </h2>
                <div
                  className="text-center py-12 rounded-lg"
                  style={{
                    border: '1px dashed var(--color-border)',
                  }}
                >
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    📚 知识库配置将在 Phase 3 中实现
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    届时将支持 Provider 选择、文档上传和检索参数配置
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div className="max-w-lg">
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  工具配置
                </h2>
                <div
                  className="text-center py-12 rounded-lg"
                  style={{
                    border: '1px dashed var(--color-border)',
                  }}
                >
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    🛠️ 工具选择器将在后续迭代中实现
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'automation' && (
              <div className="max-w-lg">
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  自动化配置
                </h2>
                <div
                  className="text-center py-12 rounded-lg"
                  style={{
                    border: '1px dashed var(--color-border)',
                  }}
                >
                  <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    ⚡ 自动化任务配置将在后续迭代中实现
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    届时将支持 Cron 定时触发、Webhook 和手动模板
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'preview' && (
              <div>
                <h2
                  className="text-lg font-semibold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  预览
                </h2>
                <div
                  className="rounded-xl p-6 max-w-md"
                  style={{
                    background: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">{icon}</span>
                    <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {name || '未命名应用'}
                    </span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
                    {description || '暂无描述'}
                  </p>

                  <div
                    className="rounded-lg p-3 mb-3"
                    style={{ background: 'var(--color-surface)' }}
                  >
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      💬 开场消息
                    </p>
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {systemPrompt
                        ? systemPrompt.slice(0, 100) + (systemPrompt.length > 100 ? '...' : '')
                        : '你好！我是你的智能助手，有什么可以帮你的？'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-3">
                    <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                      🤖 Agent: {agentId || '未选择'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                      📚 知识库: {app.ragBinding ? '已绑定' : '未绑定'}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                      🛠️ 工具: {app.enabledTools.length || 0} 个
                    </span>
                  </div>

                  {tags && (
                    <div className="flex flex-wrap gap-1">
                      {tags.split(',').filter(Boolean).map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-2 py-0.5 rounded"
                          style={{
                            background: 'var(--color-border-subtle)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 右侧预览面板 */}
          <div
            className="w-72 flex-shrink-0 p-4 overflow-y-auto"
            style={{
              borderLeft: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
            }}
          >
            <div className="flex items-center gap-1.5 mb-3">
              <Eye size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                实时预览
              </span>
            </div>
            <div
              className="rounded-lg p-4"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{icon}</span>
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {name || '未命名'}
                </span>
              </div>
              <p
                className="text-xs mb-3 line-clamp-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {description || '暂无描述'}
              </p>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span>🤖</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    Agent: {agentId || '未选择'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span>📚</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    知识库: {app.ragBinding ? '已绑定' : '未绑定'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span>🛠️</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    工具: {app.enabledTools.length || 0} 个
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span>⚡</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    自动化: {app.automations.length || 0} 个
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {label}
        {required && (
          <span style={{ color: '#ef4444', marginLeft: '2px' }}>*</span>
        )}
      </label>
      {children}
    </div>
  )
}
