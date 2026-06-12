/* 应用管理页 — /apps */
'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LayoutGrid, Plus, Search, MoreHorizontal, Pencil, Copy, Trash2, Archive, Undo2 } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import type { AppConfig, AppStatus } from '@/core/types'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// ─── 状态映射 ───────────────────────────────────────────────
const STATUS_MAP: Record<AppStatus, { label: string; color: string; dot: string }> = {
  draft: { label: '草稿', color: '#d4a017', dot: '🟡' },
  published: { label: '已发布', color: '#0e9e6a', dot: '🟢' },
  archived: { label: '已归档', color: '#6b7280', dot: '⚫' },
}

// ─── 创建应用弹窗 ───────────────────────────────────────────────
function CreateAppModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string, desc: string) => void
}) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDesc('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  if (!open) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onCreate(name.trim(), desc.trim())
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl p-6"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--color-text-primary)' }}
        >
          创建智能体应用
        </h2>
        <form onSubmit={handleSubmit}>
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            应用名称 *
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：简历筛选 Agent"
            maxLength={30}
            className="w-full px-3 py-2 rounded-lg text-sm mb-3 outline-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />

          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            描述（可选）
          </label>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="简要描述这个应用的用途..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-sm mb-4 outline-none resize-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                background: 'transparent',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                opacity: name.trim() ? 1 : 0.5,
              }}
            >
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── 确认弹窗 ───────────────────────────────────────────────
function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onClose,
  confirmLabel,
  danger,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onClose: () => void
  confirmLabel?: string
  danger?: boolean
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl p-6"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {title}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm"
            style={{
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
            }}
          >
            取消
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{
              background: danger ? '#ef4444' : 'var(--color-accent)',
              color: '#fff',
            }}
          >
            {confirmLabel ?? '确认'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 应用卡片 ───────────────────────────────────────────────
function AppCard({
  app,
  onOpen,
  onEdit,
  onClone,
  onDelete,
  onToggleStatus,
}: {
  app: AppConfig
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onClone: (id: string) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const statusInfo = STATUS_MAP[app.status]
  const updated = formatRelativeTime(app.updatedAt)

  return (
    <div
      className="rounded-xl p-5 transition-all cursor-pointer relative group"
      style={{
        background: 'var(--color-background)',
        border: '1px solid var(--color-border)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)'
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
      onClick={() => onOpen(app.id)}
    >
      {/* 顶部：图标 + 菜单 */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{app.icon}</span>
        <div className="relative">
          <button
            className="w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 transition-all"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(false)
                }}
              />
              <div
                className="absolute right-0 top-9 z-20 w-36 rounded-lg py-1 shadow-lg"
                style={{
                  background: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <MenuItem
                  icon={<Pencil size={13} />}
                  label="编辑"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onEdit(app.id)
                  }}
                />
                <MenuItem
                  icon={<Copy size={13} />}
                  label="复制"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onClone(app.id)
                  }}
                />
                <div style={{ height: '1px', background: 'var(--color-border)', margin: '4px 0' }} />
                {app.status === 'archived' ? (
                  <MenuItem
                    icon={<Undo2 size={13} />}
                    label="恢复"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      onToggleStatus(app.id)
                    }}
                  />
                ) : (
                  <MenuItem
                    icon={<Archive size={13} />}
                    label="归档"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      onToggleStatus(app.id)
                    }}
                  />
                )}
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label="删除"
                  danger
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onDelete(app.id)
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 名称 */}
      <h3
        className="text-sm font-semibold mb-1 truncate"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {app.name}
      </h3>

      {/* 描述 */}
      <p
        className="text-xs mb-3 line-clamp-2"
        style={{ color: 'var(--color-text-muted)', minHeight: '2em' }}
      >
        {app.description || '暂无描述'}
      </p>

      {/* 标签 */}
      {app.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {app.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded text-[10px]"
              style={{
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
              }}
            >
              {tag}
            </span>
          ))}
          {app.tags.length > 3 && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              +{app.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* 底部：状态 + 时间 */}
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: statusInfo.color }}
        >
          <span>{statusInfo.dot}</span>
          <span>{statusInfo.label}</span>
        </span>
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {updated}
        </span>
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: (e: React.MouseEvent) => void
  danger?: boolean
}) {
  return (
    <button
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
      style={{
        color: danger ? '#ef4444' : 'var(--color-text-secondary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-accent-subtle)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── 格式化时间 ───────────────────────────────────────────────
function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: zhCN })
      .replace('大约 ', '')
  } catch {
    return ''
  }
}

// ─── 主页面组件 ───────────────────────────────────────────────
export default function AppsPage() {
  const router = useRouter()
  const { apps, loading, error, fetchApps, createApp, deleteApp, cloneApp, changeStatus } =
    useAppStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<AppStatus | ''>('')
  const [sortBy, setSortBy] = useState('updatedAt')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'archive' | 'restore'
    appId: string
    appName: string
  } | null>(null)

  useEffect(() => {
    fetchApps()
  }, [])

  const filteredApps = apps
    .filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
        )
      }
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'createdAt')
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  async function handleCreate(name: string, desc: string) {
    const app = await createApp({ name, description: desc })
    if (app) {
      router.push(`/apps/${app.id}/builder`)
    }
  }

  function handleOpen(id: string) {
    router.push(`/apps/${id}`)
  }

  function handleEdit(id: string) {
    router.push(`/apps/${id}/builder`)
  }

  async function handleClone(id: string) {
    await cloneApp(id)
  }

  function handleDeleteClick(id: string, name: string) {
    setConfirmAction({ type: 'delete', appId: id, appName: name })
  }

  function handleArchiveClick(id: string, name: string) {
    setConfirmAction({ type: 'archive', appId: id, appName: name })
  }

  function handleRestoreClick(id: string, name: string) {
    setConfirmAction({ type: 'restore', appId: id, appName: name })
  }

  async function handleToggleStatus(appId: string) {
    const app = apps.find((a) => a.id === appId)
    if (!app) return
    if (app.status === 'archived') {
      handleRestoreClick(appId, app.name)
    } else {
      handleArchiveClick(appId, app.name)
    }
  }

  async function executeConfirm() {
    if (!confirmAction) return
    const { type, appId } = confirmAction
    if (type === 'delete') {
      await deleteApp(appId)
    } else if (type === 'archive') {
      await changeStatus(appId, 'archived')
    } else if (type === 'restore') {
      await changeStatus(appId, 'draft')
    }
    setConfirmAction(null)
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            应用管理
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            创建和管理你的智能体应用
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={16} />
          创建应用
        </button>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            placeholder="搜索应用..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--color-text-primary)' }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AppStatus | '')}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            minWidth: '100px',
          }}
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm outline-none"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        >
          <option value="updatedAt">最近更新</option>
          <option value="createdAt">创建时间</option>
          <option value="name">名称</option>
        </select>
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
          }}
        >
          {error}
        </div>
      )}

      {/* 内容区 */}
      {loading && apps.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl p-5 animate-pulse"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                height: '180px',
              }}
            />
          ))}
        </div>
      ) : filteredApps.length === 0 ? (
        <div
          className="text-center py-20 rounded-xl border"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-background)',
          }}
        >
          <LayoutGrid
            size={48}
            className="mx-auto mb-4"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {searchQuery || statusFilter ? '没有匹配的应用' : '还没有应用'}
          </p>
          <p className="text-xs mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {searchQuery || statusFilter
              ? '尝试调整搜索条件或筛选器'
              : '创建你的第一个智能体应用'}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
              }}
            >
              <Plus size={16} />
              创建应用
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredApps.map((app) => (
            <AppCard
              key={app.id}
              app={app}
              onOpen={handleOpen}
              onEdit={handleEdit}
              onClone={handleClone}
              onDelete={(id) => handleDeleteClick(id, app.name)}
              onToggleStatus={(id) => handleToggleStatus(id)}
            />
          ))}
        </div>
      )}

      {/* 创建弹窗 */}
      <CreateAppModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />

      {/* 确认弹窗 */}
      <ConfirmModal
        open={!!confirmAction}
        title={
          confirmAction?.type === 'delete'
            ? '删除应用'
            : confirmAction?.type === 'archive'
            ? '归档应用'
            : '恢复应用'
        }
        message={
          confirmAction?.type === 'delete'
            ? `确定要删除「${confirmAction?.appName}」吗？应用的对话历史和配置数据将被永久删除。`
            : confirmAction?.type === 'archive'
            ? `确定要归档「${confirmAction?.appName}」吗？归档后应用将不在默认列表中显示。`
            : `确定要将「${confirmAction?.appName}」恢复为草稿状态吗？`
        }
        confirmLabel={
          confirmAction?.type === 'delete'
            ? '删除'
            : confirmAction?.type === 'archive'
            ? '归档'
            : '恢复'
        }
        danger={confirmAction?.type === 'delete'}
        onConfirm={executeConfirm}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  )
}
