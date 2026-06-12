/* 应用详情页 — /apps/[id] */
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Pencil, MessageSquare, Settings } from 'lucide-react'
import type { AppConfig, AppStatus } from '@/core/types'

const STATUS_MAP: Record<AppStatus, { label: string; dot: string }> = {
  draft: { label: '草稿', dot: '🟡' },
  published: { label: '已发布', dot: '🟢' },
  archived: { label: '已归档', dot: '⚫' },
}

const TABS = [
  { id: 'overview', label: '概览', icon: '📊' },
  { id: 'chat', label: '对话', icon: '💬' },
  { id: 'knowledge', label: '知识库', icon: '📚' },
  { id: 'tools', label: '工具', icon: '🛠️' },
  { id: 'automation', label: '自动化', icon: '📋' },
  { id: 'evaluation', label: '评估', icon: '📈' },
]

export default function AppDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [app, setApp] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/apps/${id}`)
        const data = await res.json()
        if (data.app) {
          setApp(data.app)
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <span style={{ color: 'var(--color-text-muted)', fontSize: '14px' }}>加载中...</span>
      </div>
    )
  }

  if (!app) {
    return (
      <div className="p-8 text-center">
        <p style={{ color: 'var(--color-text-secondary)' }}>应用不存在</p>
        <button
          onClick={() => router.push('/apps')}
          className="mt-3 text-sm"
          style={{ color: 'var(--color-accent)' }}
        >
          返回应用列表
        </button>
      </div>
    )
  }

  const statusInfo = STATUS_MAP[app.status]

  return (
    <div className="p-8 max-w-6xl">
      {/* 面包屑 */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/apps')}
          className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>/</span>
        <div className="flex items-center gap-2">
          <span className="text-lg">{app.icon}</span>
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {app.name}
          </h1>
          <span
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
            style={{
              background: 'var(--color-accent-subtle)',
              color: 'var(--color-accent)',
            }}
          >
            {statusInfo.dot} {statusInfo.label}
          </span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => router.push(`/apps/${id}/builder`)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-accent)'
            e.currentTarget.style.color = 'var(--color-accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.color = 'var(--color-text-secondary)'
          }}
        >
          <Settings size={14} />
          配置
        </button>
        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <MessageSquare size={14} />
          对话
        </button>
      </div>

      {/* Tab 导航 */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all"
            style={{
              background: activeTab === tab.id ? 'var(--color-accent)' : 'transparent',
              color:
                activeTab === tab.id
                  ? 'var(--color-text-inverse)'
                  : 'var(--color-text-secondary)',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 概览面板 */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <InfoCard label="名称" value={app.name} />
          <InfoCard label="描述" value={app.description || '暂无描述'} />
          <InfoCard label="状态" value={`${statusInfo.dot} ${statusInfo.label}`} />
          <InfoCard label="Agent" value={app.agentId || '未选择'} />
          <InfoCard
            label="知识库"
            value={app.ragBinding ? `已绑定 (${app.ragBinding.knowledgeBaseId})` : '未绑定'}
          />
          <InfoCard
            label="工具"
            value={app.enabledTools.length > 0 ? app.enabledTools.join(', ') : '未启用'}
          />
          <InfoCard
            label="自动化"
            value={app.automations.length > 0 ? `${app.automations.length} 个任务` : '无'}
          />
          <InfoCard label="标签" value={app.tags.length > 0 ? app.tags.join(', ') : '无'} />
          <InfoCard
            label="创建时间"
            value={new Date(app.createdAt).toLocaleString('zh-CN')}
          />
          <InfoCard
            label="更新时间"
            value={new Date(app.updatedAt).toLocaleString('zh-CN')}
          />
          {app.publishedAt && (
            <InfoCard
              label="发布时间"
              value={new Date(app.publishedAt).toLocaleString('zh-CN')}
            />
          )}
        </div>
      )}

      {/* 其他 Tab 占位 */}
      {activeTab !== 'overview' && (
        <div
          className="text-center py-16 rounded-xl border"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-background)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {TABS.find((t) => t.id === activeTab)?.icon}{' '}
            {TABS.find((t) => t.id === activeTab)?.label} 功能将在后续阶段实现
          </p>
        </div>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-start gap-4 p-4 rounded-lg"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span
        className="text-xs font-medium min-w-[70px] pt-0.5"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </span>
    </div>
  )
}
