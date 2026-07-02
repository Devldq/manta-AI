/* 知识库管理页 — /rag */
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Plus, Search, MoreHorizontal, Trash2, FileText, Layers } from 'lucide-react'
import { useRAGStore, type KnowledgeBaseSummary } from '@/stores/rag-store'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// ─── 格式化时间 ───────────────────────────────────────────────
function formatRelativeTime(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: zhCN })
      .replace('大约 ', '')
  } catch {
    return ''
  }
}

// ─── 创建知识库弹窗 ───────────────────────────────────────────────
function CreateKBModal({
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
          创建知识库
        </h2>
        <form onSubmit={handleSubmit}>
          <label
            className="block text-xs font-medium mb-1.5"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            名称 *
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：产品文档库"
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
            placeholder="简要描述知识库的用途..."
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
  danger = false,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onClose: () => void
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
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
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
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            style={{
              background: danger ? '#ef4444' : 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 知识库卡片 ───────────────────────────────────────────────
function KBCard({
  kb,
  onOpen,
  onDelete,
}: {
  kb: KnowledgeBaseSummary
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div
      className="group relative rounded-xl p-5 cursor-pointer transition-all hover:shadow-lg"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
      onClick={() => onOpen(kb.id)}
    >
      {/* 头部 */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ background: 'var(--color-accent-subtle)' }}
          >
            📚
          </span>
          <div>
            <h3
              className="font-medium text-sm"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {kb.name}
            </h3>
            <span
              className="text-[10px]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {kb.providerId || 'sqlite-vec'}
            </span>
          </div>
        </div>

        {/* 菜单 */}
        <div className="relative" ref={menuRef}>
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md"
            style={{ background: 'transparent' }}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
          >
            <MoreHorizontal size={14} style={{ color: 'var(--color-text-muted)' }} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-10 w-32 rounded-lg shadow-lg py-1"
              style={{
                background: 'var(--color-background)',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
                style={{ color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(kb.id)
                  setMenuOpen(false)
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Trash2 size={12} />
                删除
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 描述 */}
      <p
        className="text-xs mb-4 line-clamp-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {kb.description || '暂无描述'}
      </p>

      {/* 底部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            <FileText size={10} />
            {kb.documentCount ?? 0} 文档
          </div>
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            <Layers size={10} />
            {kb.chunkCount ?? 0} 分块
          </div>
        </div>
        <span
          className="text-[10px]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {formatRelativeTime(kb.updatedAt)}
        </span>
      </div>
    </div>
  )
}

// ─── 主页面组件 ───────────────────────────────────────────────
export default function RagPage() {
  const navigate = useNavigate()
  const { knowledgeBases, loading, error, fetchKnowledgeBases, createKnowledgeBase, deleteKnowledgeBase } =
    useRAGStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string
    name: string
  } | null>(null)

  useEffect(() => {
    fetchKnowledgeBases()
  }, [])

  const filtered = knowledgeBases
    .filter((kb) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return (
        kb.name.toLowerCase().includes(q) ||
        kb.description.toLowerCase().includes(q)
      )
    })
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

  async function handleCreate(name: string, desc: string) {
    const ok = await createKnowledgeBase({ name, description: desc })
    if (ok) {
      // 创建成功后跳转到详情页
      const state = useRAGStore.getState()
      const created = state.knowledgeBases.find((kb) => kb.name === name)
      if (created) {
        navigate(`/rag/${created.id}`)
      }
    }
  }

  function handleOpen(id: string) {
    navigate(`/rag/${id}`)
  }

  async function handleDeleteConfirm() {
    if (!confirmDelete) return
    await deleteKnowledgeBase(confirmDelete.id)
    setConfirmDelete(null)
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
            知识库
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            上传文档、构建知识库，为智能体提供 RAG 检索增强能力
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
          创建知识库
        </button>
      </div>

      {/* 搜索栏 */}
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
            placeholder="搜索知识库..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: 'var(--color-text-primary)' }}
          />
        </div>
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
      {loading && knowledgeBases.length === 0 ? (
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
      ) : filtered.length === 0 ? (
        <div
          className="text-center py-20 rounded-xl border"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-background)',
          }}
        >
          <Library
            size={48}
            className="mx-auto mb-4"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {searchQuery ? '没有匹配的知识库' : '还没有知识库'}
          </p>
          <p className="text-xs mb-6" style={{ color: 'var(--color-text-muted)' }}>
            {searchQuery
              ? '尝试调整搜索条件'
              : '上传文档并构建你的第一个 RAG 知识库'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
              }}
            >
              <Plus size={16} />
              创建知识库
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((kb) => (
            <KBCard
              key={kb.id}
              kb={kb}
              onOpen={handleOpen}
              onDelete={(id) =>
                setConfirmDelete({
                  id,
                  name: kb.name,
                })
              }
            />
          ))}
        </div>
      )}

      {/* 创建弹窗 */}
      <CreateKBModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!confirmDelete}
        title="删除知识库"
        message={
          confirmDelete
            ? `确定要删除「${confirmDelete.name}」吗？所有文档和向量数据将被永久删除。`
            : ''
        }
        danger
        onConfirm={handleDeleteConfirm}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  )
}
