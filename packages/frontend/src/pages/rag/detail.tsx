/* 知识库详情页 — /rag/:id */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Upload,
  FileText,
  Trash2,
  Search,
  Loader2,
  Layers,
  HardDrive,
  FileWarning,
  CheckCircle2,
  Clock,
  AlertCircle,
  Database,
  Copy,
  X,
} from 'lucide-react'
import { useRAGDetailStore, type DocumentInfo, type ChunkPreview, type SearchResult } from '@/stores/rag-detail-store'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

// ─── 工具函数 ─────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: zhCN }).replace('大约 ', '')
  } catch {
    return ''
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

function docTypeLabel(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'text/plain': 'TXT',
    'text/markdown': 'MD',
    'text/csv': 'CSV',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
  }
  for (const [k, v] of Object.entries(map)) {
    if (mime.includes(k) || k.includes(mime)) return v
  }
  return mime.split('/').pop()?.toUpperCase() || 'FILE'
}

const STATUS_CONFIG: Record<DocumentInfo['status'], { icon: JSX.Element; color: string; label: string }> = {
  pending: { icon: <Clock size={12} />, color: '#f59e0b', label: '待处理' },
  processing: { icon: <Loader2 size={12} className="animate-spin" />, color: '#3b82f6', label: '处理中' },
  ready: { icon: <CheckCircle2 size={12} />, color: '#22c55e', label: '就绪' },
  error: { icon: <AlertCircle size={12} />, color: '#ef4444', label: '失败' },
}

// ─── 确认弹窗 ─────────────────────────────────────────────────
function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onClose: () => void
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
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{title}</h3>
        <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', background: 'transparent' }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 分块预览弹窗 ─────────────────────────────────────────────
function ChunkViewerModal({
  open,
  chunk,
  onClose,
}: {
  open: boolean
  chunk: ChunkPreview | null
  onClose: () => void
}) {
  if (!open || !chunk) return null

  async function copyContent() {
    await navigator.clipboard.writeText(chunk!.content)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-xl max-h-[80vh] flex flex-col"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>分块内容</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              ID: {chunk.id} · {chunk.content.length} 字符
              {chunk.startIndex !== undefined && chunk.endIndex !== undefined && (
                <span> · 位置: {chunk.startIndex}-{chunk.endIndex}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyContent}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              title="复制内容"
            >
              <Copy size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-auto p-4">
          <pre
            className="text-xs whitespace-pre-wrap font-mono leading-relaxed"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {chunk.content}
          </pre>
          {Object.keys(chunk.metadata).length > 0 && (
            <div
              className="mt-3 pt-3 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-muted)' }}>元数据</p>
              <pre
                className="text-[10px] whitespace-pre-wrap"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {JSON.stringify(chunk.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 统计卡片 ─────────────────────────────────────────────────
function StatCard({ icon, label, value }: { icon: JSX.Element; label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-lg"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div style={{ color: 'var(--color-accent)' }}>{icon}</div>
      <div>
        <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>{value}</p>
      </div>
    </div>
  )
}

// ─── 文档卡片 ─────────────────────────────────────────────────
function DocCard({
  doc,
  onDelete,
  onViewChunks,
}: {
  doc: DocumentInfo
  onDelete: () => void
  onViewChunks: () => void
}) {
  const s = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 rounded-lg transition-all hover:shadow-sm"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      {/* 类型图标 */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--color-accent-subtle)' }}
      >
        <FileText size={18} style={{ color: 'var(--color-accent)' }} />
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
            {doc.name}
          </h4>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
            style={{ background: `${s.color}15`, color: s.color }}
          >
            {s.icon} {s.label}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {docTypeLabel(doc.type)}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {formatBytes(doc.size)}
          </span>
          {doc.chunkCount !== undefined && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {doc.chunkCount} 分块
            </span>
          )}
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {formatTime(doc.uploadedAt)}
          </span>
        </div>
        {doc.error && (
          <p className="text-[10px] mt-1" style={{ color: '#ef4444' }}>{doc.error}</p>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {doc.status === 'ready' && (
          <button
            onClick={onViewChunks}
            className="p-1.5 rounded-md transition-colors text-xs"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            title="查看分块"
          >
            <Layers size={14} />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}
          title="删除文档"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── 检索结果卡片 ─────────────────────────────────────────────
function SearchResultCard({ result }: { result: SearchResult }) {
  const [expanded, setExpanded] = useState(false)

  const scorePercent = Math.round(result.score * 100)
  const scoreColor = scorePercent >= 80 ? '#22c55e' : scorePercent >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
              {result.chunk.metadata?.source || result.chunk.documentId?.slice(0, 8)}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              Chunk: {result.chunk.id.slice(0, 8)}
            </span>
          </div>
          <span
            className="text-xs font-mono font-semibold"
            style={{ color: scoreColor }}
          >
            {scorePercent}%
          </span>
        </div>
        <div className="relative">
          <p
            className={`text-xs leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {result.chunk.content}
          </p>
          {result.chunk.content.length > 200 && !expanded && (
            <div
              className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
              style={{ background: 'linear-gradient(transparent, var(--color-surface))' }}
            />
          )}
        </div>
        {result.chunk.content.length > 200 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] mt-1 transition-colors"
            style={{ color: 'var(--color-accent)' }}
          >
            {expanded ? '收起' : '展开全部'}
          </button>
        )}
      </div>

      {/* 进度条 */}
      <div className="h-1" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full transition-all"
          style={{ width: `${scorePercent}%`, background: scoreColor }}
        />
      </div>
    </div>
  )
}

// ─── 主页面组件 ───────────────────────────────────────────────
const TABS = [
  { id: 'documents', label: '文档管理' },
  { id: 'search', label: '检索测试' },
  { id: 'chunks', label: '分块预览' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function RAGDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const store = useRAGDetailStore()

  const [activeTab, setActiveTab] = useState<TabId>('documents')
  const [dragOver, setDragOver] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ docId: string; name: string } | null>(null)
  const [viewChunk, setViewChunk] = useState<ChunkPreview | null>(null)
  const [chunksDocFilter, setChunksDocFilter] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── 加载知识库详情 ─────────────────────────────────────────
  useEffect(() => {
    if (id) {
      store.fetchKnowledgeBase(id)
      store.fetchDocuments(id)
    }
    return () => { store.reset() }
  }, [id])

  // ─── 文档上传 ───────────────────────────────────────────────
  const handleUpload = useCallback(
    async (file: File) => {
      if (!id) return
      const ok = await store.uploadDocument(id, file)
      if (!ok) {
        setTimeout(() => store.uploadError && null, 5000) // 错误将在 UI 中展示
      }
    },
    [id]
  )

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  // ─── 检索 ───────────────────────────────────────────────────
  function handleSearch() {
    if (!searchInput.trim() || !id) return
    store.search(id, searchInput.trim())
  }

  // ─── 删除文档 ───────────────────────────────────────────────
  async function handleDeleteDoc() {
    if (!deleteTarget || !id) return
    await store.deleteDocument(id, deleteTarget.docId)
    setDeleteTarget(null)
  }

  // ─── 查看分块 ───────────────────────────────────────────────
  function handleViewChunks(docId: string) {
    if (!id) return
    setActiveTab('chunks')
    setChunksDocFilter(docId)
    store.fetchChunks(id, docId)
  }

  // ─── 加载状态 ───────────────────────────────────────────────
  if (store.kbLoading && !store.kb) {
    return (
      <div className="p-8 max-w-6xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded" style={{ background: 'var(--color-surface)' }} />
          <div className="flex gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 flex-1 rounded-lg" style={{ background: 'var(--color-surface)' }} />
            ))}
          </div>
          <div className="h-96 rounded-lg" style={{ background: 'var(--color-surface)' }} />
        </div>
      </div>
    )
  }

  // ─── 未找到 ─────────────────────────────────────────────────
  if (!store.kb && !store.kbLoading) {
    return (
      <div className="p-8 text-center">
        <FileWarning size={48} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
        <p style={{ color: 'var(--color-text-secondary)' }}>知识库不存在</p>
        <button
          onClick={() => navigate('/rag')}
          className="mt-3 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-accent)' }}
        >
          返回知识库列表
        </button>
      </div>
    )
  }

  const kb = store.kb!

  return (
    <div className="p-8 max-w-6xl">
      {/* ── 面包屑 + 头部 ─────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/rag')}
          className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <ArrowLeft size={16} />
          返回
        </button>
        <span style={{ color: 'var(--color-text-muted)' }}>/</span>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          {kb.name}
        </h1>
      </div>

      {/* 描述 */}
      {kb.description && (
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          {kb.description}
        </p>
      )}

      {/* ── 统计卡片 ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<FileText size={16} />} label="文档数" value={`${kb.documentCount}`} />
        <StatCard icon={<Layers size={16} />} label="分块数" value={`${kb.chunkCount}`} />
        <StatCard icon={<Database size={16} />} label="Provider" value={kb.providerId || 'sqlite-vec'} />
        <StatCard icon={<Clock size={16} />} label="更新时间" value={formatTime(kb.updatedAt)} />
      </div>

      {/* ── Tab 导航 ─────────────────────────────────────── */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-1.5 rounded text-xs font-medium transition-all"
            style={{
              background: activeTab === tab.id ? 'var(--color-accent)' : 'transparent',
              color: activeTab === tab.id ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 错误提示 ─────────────────────────────────────── */}
      {(store.kbError || store.docsError || store.uploadError) && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm flex items-center justify-between"
          style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
        >
          <span>{store.kbError || store.docsError || store.uploadError}</span>
          <button onClick={() => useRAGDetailStore.setState({ kbError: null, docsError: null, uploadError: null })}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          文档管理 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'documents' && (
        <div className="space-y-4">
          {/* 上传区域 */}
          <div
            className={`relative rounded-xl border-2 border-dashed p-10 text-center transition-all cursor-pointer ${
              dragOver ? 'scale-[1.02]' : ''
            }`}
            style={{
              borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
              background: dragOver ? 'var(--color-accent-subtle)' : 'var(--color-background)',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,.html,.json,.xml"
              onChange={onFileSelect}
            />
            {store.uploadProgress !== null ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>正在上传并处理文档...</p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>解析 → 分块 → 向量化 → 写入向量库</p>
              </div>
            ) : (
              <>
                <Upload size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
                  拖拽文件到此处或点击上传
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  支持 PDF、DOCX、XLSX、PPTX、TXT、MD、CSV · 最大 50MB
                </p>
              </>
            )}
          </div>

          {/* 文档列表 */}
          {store.docsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
              ))}
            </div>
          ) : store.documents.length === 0 ? (
            <div
              className="text-center py-12 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
            >
              <FileText size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>暂无文档</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>上传文档以构建知识库</p>
            </div>
          ) : (
            <div className="space-y-2">
              {store.documents.map((doc) => (
                <DocCard
                  key={doc.id}
                  doc={doc}
                  onDelete={() => setDeleteTarget({ docId: doc.id, name: doc.name })}
                  onViewChunks={() => handleViewChunks(doc.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          检索测试 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'search' && (
        <div className="space-y-4">
          {/* 搜索栏 */}
          <div className="flex items-center gap-3">
            <div
              className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <Search size={16} style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                placeholder="输入检索关键词..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--color-text-primary)' }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!searchInput.trim() || store.searchLoading}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity flex items-center gap-2"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                opacity: !searchInput.trim() || store.searchLoading ? 0.5 : 1,
              }}
            >
              {store.searchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              检索
            </button>
          </div>

          {/* 检索错误 */}
          {store.searchError && (
            <div
              className="px-4 py-3 rounded-lg text-sm"
              style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
            >
              {store.searchError}
            </div>
          )}

          {/* 检索结果 */}
          {store.searchQuery && !store.searchLoading && (
            <div className="mb-2">
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                查询「{store.searchQuery}」— 找到 {store.searchResults.length} 条结果
              </p>
            </div>
          )}

          {store.searchLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
              ))}
            </div>
          ) : store.searchResults.length > 0 ? (
            <div className="space-y-3">
              {store.searchResults.map((r, i) => (
                <SearchResultCard key={i} result={r} />
              ))}
            </div>
          ) : store.searchQuery ? (
            <div
              className="text-center py-12 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
            >
              <Search size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>未找到匹配结果</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>尝试使用不同的关键词检索</p>
            </div>
          ) : (
            <div
              className="text-center py-16 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
            >
              <Search size={40} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>输入关键词进行检索测试</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>测试知识库的检索效果，查看返回的相关文档块和相似度分数</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          分块预览 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'chunks' && (
        <div className="space-y-4">
          {/* 文档选择器 */}
          <div className="flex items-center gap-3">
            <select
              value={chunksDocFilter}
              onChange={(e) => {
                const docId = e.target.value
                setChunksDocFilter(docId)
                if (docId && id) store.fetchChunks(id, docId)
              }}
              className="px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="">选择文档...</option>
              {store.documents
                .filter((d) => d.status === 'ready')
                .map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.name} ({doc.chunkCount ?? 0} 分块)
                  </option>
                ))}
            </select>
            {store.chunksTotal > 0 && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                共 {store.chunksTotal} 个分块
              </span>
            )}
          </div>

          {/* 分块列表 */}
          {store.chunksLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
              ))}
            </div>
          ) : store.chunksError ? (
            <div
              className="px-4 py-3 rounded-lg text-sm"
              style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
            >
              {store.chunksError}
            </div>
          ) : store.chunks.length > 0 ? (
            <div className="space-y-2">
              {store.chunks.map((chunk, i) => (
                <div
                  key={chunk.id}
                  className="rounded-lg p-4 cursor-pointer transition-all hover:shadow-sm"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  onClick={() => setViewChunk(chunk)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                      >
                        #{i + 1}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        {chunk.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {chunk.content.length} 字符
                      {chunk.startIndex !== undefined && chunk.endIndex !== undefined && (
                        <span> · [{chunk.startIndex}, {chunk.endIndex}]</span>
                      )}
                    </span>
                  </div>
                  <p
                    className="text-xs leading-relaxed line-clamp-2"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          ) : chunksDocFilter ? (
            <div
              className="text-center py-12 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
            >
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>未找到分块数据</p>
            </div>
          ) : (
            <div
              className="text-center py-16 rounded-xl border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-background)' }}
            >
              <Layers size={40} className="mx-auto mb-4" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>选择文档查看分块</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                查看文档被分割为哪些块，以及每个块的内容和元数据
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── 弹窗 ─────────────────────────────────────────── */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除文档"
        message={deleteTarget ? `确定要删除「${deleteTarget.name}」吗？相关的向量数据也会被删除。` : ''}
        onConfirm={handleDeleteDoc}
        onClose={() => setDeleteTarget(null)}
      />

      <ChunkViewerModal open={!!viewChunk} chunk={viewChunk} onClose={() => setViewChunk(null)} />
    </div>
  )
}
