/* 知识库详情页 — /rag/:id
 * 设计方向：与项目整体风格对齐，克制、精致、轻量
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Upload,
  FileText,
  Trash2,
  Search,
  Loader2,
  Layers,
  Database,
  FileWarning,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  X,
  Save,
  Bot,
  Globe,
  Hash,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileSearch,
  MessageSquare,
  RefreshCw,
  Info,
  FolderUp,
  Play,
  Settings2,
  Scissors,
  Sparkles,
  XCircle,
  Edit2,
} from 'lucide-react'
import {
  useRAGDetailStore,
  type DocumentInfo,
  type ChunkPreview,
  type SearchResult,
  type RAGConfig,
  type ChatMessage,
  type LLMProfileOption,
  type ChunkingConfig,
} from '@/stores/rag-detail-store'
import { formatDistanceToNow } from 'date-fns'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { zhCN } from 'date-fns/locale'

// ─── 工具函数 ─────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化耗时（毫秒 → 可读字符串） */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return sec > 0 ? `${min}m${sec}s` : `${min}m`
}

function formatTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: zhCN }).replace('大约 ', '')
  } catch {
    return ''
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

// ─── 状态配置 ─────────────────────────────────────────────────
const STATUS_CONFIG: Record<DocumentInfo['status'], { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock size={10} />, color: 'var(--color-status-pending)', label: '待处理' },
  processing: { icon: <Loader2 size={10} className="animate-spin" />, color: 'var(--color-status-running)', label: '处理中' },
  ready: { icon: <CheckCircle2 size={10} />, color: 'var(--color-status-done)', label: '就绪' },
  error: { icon: <AlertCircle size={10} />, color: 'var(--color-status-failed)', label: '失败' },
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
        className="w-full max-w-sm mx-4 rounded-xl p-5"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>{title}</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs transition-colors"
            style={{
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              background: 'transparent'
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: '#ef4444', color: '#fff' }}
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 编辑知识库弹窗 ─────────────────────────────────────────
function EditKBInfoModal({
  open,
  name,
  description,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  name: string
  description: string
  saving: boolean
  onClose: () => void
  onSave: (name: string, description: string) => void
}) {
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setEditName(name)
      setEditDesc(description)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open, name, description])

  if (!open) return null

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
        <h2 className="text-sm font-medium mb-4" style={{ color: 'var(--color-text-primary)' }}>
          编辑知识库信息
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!editName.trim() || saving) return
            onSave(editName.trim(), editDesc.trim())
          }}
        >
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            名称 *
          </label>
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            maxLength={30}
            className="w-full px-3 py-2 rounded-lg text-sm mb-3 outline-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            描述（可选）
          </label>
          <textarea
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
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
              className="px-3 py-1.5 rounded-lg text-xs transition-colors"
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
              disabled={!editName.trim() || saving}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
                opacity: editName.trim() && !saving ? 1 : 0.5,
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── 分块预览弹窗（支持上下导航 + 元数据展示）──────────────────
function ChunkViewerModal({
  open,
  chunks,
  currentIndex,
  onClose,
  onNavigate,
}: {
  open: boolean
  chunks: ChunkPreview[]
  currentIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const [copied, setCopied] = useState(false)
  const chunk = chunks[currentIndex]

  async function copyContent() {
    if (!chunk) return
    await navigator.clipboard.writeText(chunk.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (currentIndex > 0) onNavigate(currentIndex - 1)
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (currentIndex < chunks.length - 1) onNavigate(currentIndex + 1)
      }
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose, currentIndex, chunks.length, onNavigate])

  if (!open || !chunk) return null

  const meta = chunk.metadata || {}
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < chunks.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl flex flex-col"
        style={{
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          maxHeight: '80vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Layers size={14} style={{ color: 'var(--color-text-muted)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>分块详情</span>
            {meta.source && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                {meta.source as string}
              </span>
            )}
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              {currentIndex + 1}/{chunks.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* 导航 */}
            <button
              onClick={() => hasPrev && onNavigate(currentIndex - 1)}
              disabled={!hasPrev}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
              style={{ color: 'var(--color-text-muted)' }}
              title="上一个 (↑)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={() => hasNext && onNavigate(currentIndex + 1)}
              disabled={!hasNext}
              className="p-1.5 rounded-lg transition-colors disabled:opacity-30"
              style={{ color: 'var(--color-text-muted)' }}
              title="下一个 (↓)"
            >
              <ChevronDown size={14} />
            </button>
            <div className="w-px h-4 mx-0.5" style={{ background: 'var(--color-border)' }} />
            <button
              onClick={copyContent}
              className="p-1.5 rounded-lg transition-colors"
              style={{ background: copied ? 'var(--color-accent-subtle)' : 'transparent', color: copied ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              title="复制内容"
            >
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 元数据条 */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-b flex-wrap" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {meta.index != null && (
            <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--color-text-muted)' }}>
              <Hash size={9} /> #{meta.index}
            </span>
          )}
          {meta.tokenEstimate != null && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
              ~{meta.tokenEstimate} tok
            </span>
          )}
          {chunk.startIndex != null && chunk.endIndex != null && (
            <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
              pos: {chunk.startIndex}-{chunk.endIndex}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre
            className="text-xs whitespace-pre-wrap leading-relaxed p-3 rounded-lg"
            style={{
              color: 'var(--color-text-primary)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            {chunk.content}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ─── 向量模型配置面板 ─────────────────────────────────────────
function EmbeddingSettingsPanel({
  kb,
  ragConfig,
}: {
  kb: ReturnType<typeof useRAGDetailStore.getState>['kb']
  ragConfig: RAGConfig | null
}) {
  const store = useRAGDetailStore()
  const [provider, setProvider] = useState<'openai' | 'local'>(
    kb?.config.embeddingConfig?.provider || 'openai'
  )
  const [model, setModel] = useState(kb?.config.embeddingConfig?.model || '')
  const [apiKey, setApiKey] = useState(kb?.config.embeddingConfig?.apiKey || '')
  const [baseUrl, setBaseUrl] = useState(kb?.config.embeddingConfig?.baseUrl || '')
  const [dimensions, setDimensions] = useState(kb?.config.embeddingConfig?.dimensions || kb?.config.dimensions || 1536)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!kb) return
    const ec = kb.config.embeddingConfig
    setProvider(ec?.provider || 'openai')
    setModel(ec?.model || '')
    setApiKey(ec?.apiKey || '')
    setBaseUrl(ec?.baseUrl || '')
    setDimensions(ec?.dimensions || kb.config.dimensions || 1536)
  }, [kb])

  // 切换 provider 时自动选择默认模型并更新维度
  useEffect(() => {
    const currentProvider = ragConfig?.availableProviders?.find((p) => p.id === provider)
    const modelOptions = currentProvider?.models || []

    if (modelOptions.length > 0) {
      // 如果当前模型不在可用列表中，选择第一个
      if (!model || !modelOptions.find((m) => m.id === model)) {
        const defaultModel = modelOptions[0]
        setModel(defaultModel.id)
        setDimensions(defaultModel.dimensions)
      }
    } else if (provider === 'openai') {
      // OpenAI 默认维度
      setDimensions(1536)
    }
  }, [provider, ragConfig])

  const currentProvider = ragConfig?.availableProviders?.find((p) => p.id === provider)
  const modelOptions = currentProvider?.models || []
  const ragConfigLoading = store.ragConfigLoading
  const ragConfigError = !ragConfig && !ragConfigLoading

  async function handleSave() {
    if (!kb) return
    const ok = await store.updateConfig(kb.id, {
      dimensions,
      embeddingConfig: {
        provider,
        model: model || undefined,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        dimensions,
      },
    })
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="space-y-4 max-w-lg">
      {/* 提示 */}
      <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        为该知识库指定 Embedding 模型。配置优先级：知识库设置 &gt; 环境变量。
      </p>

      {/* Provider 选择 */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Provider</label>
        <div className="flex gap-2">
          {(ragConfig?.availableProviders || [
            { id: 'openai', name: 'OpenAI' },
            { id: 'local', name: 'Ollama (本地)' },
          ]).map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setProvider(p.id as 'openai' | 'local')
                setModel('')
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: provider === p.id ? 'var(--color-accent)' : 'var(--color-surface)',
                color: provider === p.id ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                border: provider === p.id ? 'none' : '1px solid var(--color-border)',
              }}
            >
              {p.id === 'openai' ? <Globe size={12} /> : <Bot size={12} />}
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 模型选择 */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>模型</label>
        {ragConfigLoading ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <Loader2 size={12} className="animate-spin" />
            <span>正在读取本地模型…</span>
          </div>
        ) : modelOptions.length > 0 ? (
          <Select
            value={model}
            onValueChange={(selectedId) => {
              setModel(selectedId)
              const selected = modelOptions.find((m) => m.id === selectedId)
              if (selected) setDimensions(selected.dimensions)
            }}
          >
            <SelectTrigger className="w-full h-9 text-xs bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-primary)] focus:ring-[var(--color-accent)]">
              <SelectValue placeholder="使用默认模型" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--color-surface-elevated)] border-[var(--color-border)]">
              {modelOptions.map((m) => (
                <SelectItem
                  key={m.id}
                  value={m.id}
                  className="text-xs text-[var(--color-text-primary)] focus:bg-[var(--color-accent-subtle)] focus:text-[var(--color-accent)]"
                >
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="输入模型名称，如 nomic-embed-text"
              className="w-full px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            />
            {provider === 'local' && ragConfigError && (
              <p className="text-[10px]" style={{ color: 'var(--color-status-failed)' }}>
                未检测到本地 Ollama 模型。请确认 ollama 已运行，且已安装 embedding 模型。
              </p>
            )}
          </div>
        )}
      </div>

      {/* 向量维度 */}
      <div className="space-y-2">
        <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>向量维度</label>
        <input
          type="number"
          value={dimensions}
          onChange={(e) => setDimensions(parseInt(e.target.value) || 1536)}
          min={64}
          max={4096}
          step={64}
          className="w-full px-3 py-2 rounded-lg text-xs outline-none"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        />
      </div>

      {/* API Key（仅 OpenAI） */}
      {provider === 'openai' && (
        <div className="space-y-2">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            API Key <span style={{ color: 'var(--color-text-muted)' }}>（可选）</span>
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
      )}

      {/* Base URL（仅 OpenAI） */}
      {provider === 'openai' && (
        <div className="space-y-2">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            API Base URL <span style={{ color: 'var(--color-text-muted)' }}>（可选）</span>
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2 rounded-lg text-xs outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
      )}

      {/* Ollama 说明 */}
      {provider === 'local' && (
        <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          Ollama 服务需运行于 <code className="px-1 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)' }}>localhost:11434</code>
          ，拉取模型：<code className="px-1 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>ollama pull {model || 'nomic-embed-text'}</code>
        </p>
      )}

      {/* 保存按钮 */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={store.configSaving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: saved ? 'var(--color-status-done)' : 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
        >
          {store.configSaving ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              保存中...
            </>
          ) : saved ? (
            <>
              <CheckCircle2 size={12} />
              已保存
            </>
          ) : (
            <>
              <Save size={12} />
              保存配置
            </>
          )}
        </button>
        {store.configError && (
          <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-status-failed)' }}>
            <AlertCircle size={10} />
            {store.configError}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── 信息条目（知识库详情面板用）──────────────────────────
function InfoItem({
  label,
  value,
  mono,
  time,
}: {
  label: string
  value: string
  mono?: boolean
  time?: boolean
}) {
  const displayValue = time ? formatTimeFull(value) : value

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span
        className={`text-xs truncate ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--color-text-primary)' }}
        title={mono ? value : undefined}
      >
        {displayValue}
      </span>
    </div>
  )
}

function formatTimeFull(iso: string): string {
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const h = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    const s = String(d.getSeconds()).padStart(2, '0')
    return `${y}-${m}-${day} ${h}:${min}:${s}`
  } catch {
    return iso
  }
}

// ─── 文档处理进度可视化 ───────────────────────────────────────
const PROCESS_STAGES: { id: string; label: string; icon: React.ElementType }[] = [
  { id: 'uploading', label: '上传', icon: Upload },
  { id: 'parsing', label: '解析', icon: FileText },
  { id: 'chunking', label: '分块', icon: Layers },
  { id: 'embedding', label: '向量化', icon: Bot },
  { id: 'storing', label: '存储', icon: Database },
]

function normalizeProgress(stage: string | null, progress: number): number {
  if (stage === 'done') return 100
  if (stage === 'uploading') return Math.min(progress * 0.1, 10)
  const ranges: Record<string, [number, number]> = {
    parsing: [10, 25],
    chunking: [25, 45],
    embedding: [45, 80],
    storing: [80, 95],
  }
  if (stage && ranges[stage]) {
    const [start, end] = ranges[stage]
    return start + (progress / 100) * (end - start)
  }
  return 0
}

function ProcessingIndicator({
  fileName,
  stage,
  progress,
  message,
  chunkCount,
}: {
  fileName: string
  stage: string | null
  progress: number
  message: string | null
  chunkCount: number | null
}) {
  const overall = normalizeProgress(stage, progress)
  const currentStageIndex = PROCESS_STAGES.findIndex((s) => s.id === stage)
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (overall / 100) * circumference

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
        {/* 环形进度 */}
        <div className="relative shrink-0 w-16 h-16">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 60 60">
            <circle
              cx="30"
              cy="30"
              r={radius}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth="5"
            />
            <circle
              cx="30"
              cy="30"
              r={radius}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.4s ease' }}
            />
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
            style={{ color: 'var(--color-accent)' }}
          >
            {Math.round(overall)}%
          </div>
        </div>

        {/* 文字信息 */}
        <div className="flex-1 text-center sm:text-left min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
            {fileName}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {message ?? '正在处理...'}
          </p>
          {chunkCount !== null && chunkCount > 0 && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
              已处理 {chunkCount} 个分块
            </p>
          )}
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 rounded-full mt-4 overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${overall}%`,
            background: 'var(--color-accent)',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* 阶段节点 */}
      <div className="flex justify-between mt-3">
        {PROCESS_STAGES.map((s, i) => {
          const isCompleted = currentStageIndex > i || stage === 'done'
          const isActive = currentStageIndex === i && stage !== 'done'
          const Icon = s.icon
          return (
            <div key={s.id} className="flex flex-col items-center gap-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                style={{
                  background: isActive || isCompleted ? 'var(--color-accent)' : 'var(--color-surface)',
                  border: `1px solid ${isActive || isCompleted ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {isCompleted ? (
                  <CheckCircle2 size={12} style={{ color: 'var(--color-text-inverse)' }} />
                ) : (
                  <Icon size={12} style={{ color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)' }} />
                )}
              </div>
              <span
                className="text-[10px]"
                style={{
                  color: isActive || isCompleted ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                }}
              >
                {s.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── 分块策略配置 ─────────────────────────────────────────────

const CHUNKING_STRATEGIES: {
  id: ChunkingConfig['strategy']
  label: string
  description: string
}[] = [
  { id: 'recursive', label: '递归分块', description: '按段落→句子→分隔符逐级递归切分，保持语义完整性' },
  { id: 'fixed', label: '固定长度', description: '按固定字符数切分，支持重叠窗口和分隔符断点' },
  { id: 'semantic', label: '语义分块', description: '基于段落语义边界切分，适合结构化文档' },
]

function ChunkingConfigPanel({ kbId }: { kbId?: string }) {
  const store = useRAGDetailStore()
  const config = store.chunkingConfig
  const [saved, setSaved] = useState(false)

  async function handleSaveDefault() {
    if (!kbId) return
    const ok = await store.updateConfig(kbId, { chunkingConfig: config })
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div
      className="rounded-lg px-2.5 py-2 space-y-2"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Row 1: 策略选择 */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium shrink-0" style={{ color: 'var(--color-text-muted)' }}>策略</span>
        <div className="flex gap-1">
          {CHUNKING_STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={() => store.updateChunkingConfig({ strategy: s.id })}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background: config.strategy === s.id ? 'var(--color-accent)' : 'transparent',
                color: config.strategy === s.id ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                border: `1px solid ${config.strategy === s.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
              title={s.description}
            >
              {s.label}
            </button>
          ))}
        </div>
        {kbId && (
          <button
            onClick={handleSaveDefault}
            disabled={store.configSaving}
            className="ml-auto inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{
              background: saved ? 'var(--color-status-done)' : 'transparent',
              color: saved ? '#fff' : 'var(--color-text-muted)',
              border: `1px solid ${saved ? 'var(--color-status-done)' : 'var(--color-border)'}`,
            }}
          >
            {store.configSaving ? <Loader2 size={9} className="animate-spin" /> : saved ? <CheckCircle2 size={9} /> : <Save size={9} />}
            {saved ? '已保存' : '保存'}
          </button>
        )}
      </div>

      {/* Row 2: 分块大小 + 重叠 + 并行数 (内联紧凑) */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <label className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>大小</label>
          <input
            type="number"
            value={config.chunkSize}
            onChange={(e) => store.updateChunkingConfig({ chunkSize: parseInt(e.target.value) || 512 })}
            min={64}
            max={8192}
            step={64}
            className="w-16 px-1.5 py-0.5 rounded text-[11px] outline-none tabular-nums"
            style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>tok</span>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>重叠</label>
          <input
            type="number"
            value={config.overlap}
            onChange={(e) => store.updateChunkingConfig({ overlap: parseInt(e.target.value) || 0 })}
            min={0}
            max={2048}
            step={16}
            className="w-14 px-1.5 py-0.5 rounded text-[11px] outline-none tabular-nums"
            style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>tok</span>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <label className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>并行</label>
          <select
            value={config.batchConcurrency}
            onChange={(e) => store.updateChunkingConfig({ batchConcurrency: parseInt(e.target.value) })}
            className="w-12 px-1 py-0.5 rounded text-[11px] outline-none tabular-nums text-center appearance-none"
            style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          >
            {[1, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

function stageLabel(stage: string | null | undefined): string {
  switch (stage) {
    case 'done': return '完成'
    case 'processing': return '处理中'
    case 'embedding': return '向量化'
    case 'chunking': return '分块'
    case 'parsing': return '解析'
    case 'storing': return '存储'
    case 'uploading': return '上传中'
    case 'pending': return '等待中'
    case 'error': return '失败'
    default: return '处理中'
  }
}

// ─── 截断标题 + 1s 延迟 tooltip ────────────────────────────

function TruncatedTitle({ text, className = '', style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const [showTip, setShowTip] = useState(false)
  const [tipPos, setTipPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePos = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setTipPos({ top: rect.top - 8, left: rect.left })
    }
  }, [])

  const handleEnter = () => {
    updatePos()
    timerRef.current = setTimeout(() => setShowTip(true), 1000)
  }
  const handleLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setShowTip(false)
  }

  return (
    <>
      <span ref={triggerRef} className="block truncate" style={style} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
        <span className={`${className}`}>{text}</span>
      </span>
      {showTip && createPortal(
        <span
          className="fixed z-[9999] max-w-xs px-2 py-1 rounded text-[11px] leading-relaxed shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            top: tipPos.top - 28,
            left: tipPos.left,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  )
}

// ─── 暂存文件卡片 ─────────────────────────────────────────────

function StagedFileItem({
  name,
  size,
  relativePath,
  stage,
  progress,
  error,
  onRemove,
  onPreview,
  previewing,
  startTime,
}: {
  name: string
  size: number
  relativePath?: string
  stage?: string | null
  progress?: number
  error?: string
  onRemove?: () => void
  onPreview?: () => void
  previewing?: boolean
  startTime?: number
}) {
  const processing = stage !== undefined && stage !== null && stage !== 'pending'
  const isDone = stage === 'done'
  const isError = stage === 'error'
  const progressColor = isError
    ? 'var(--color-status-failed)'
    : isDone
      ? 'var(--color-status-done)'
      : 'var(--color-accent)'

  // 计算耗时（处理中的实时更新，完成的显示最终耗时）
  const elapsed = startTime ? Date.now() - startTime : undefined

  return (
    <div
      className="group rounded-lg transition-colors px-2.5 py-2"
      style={{ background: 'var(--color-background)' }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--color-accent-subtle)' }}
        >
          {isDone ? (
            <CheckCircle2 size={12} style={{ color: 'var(--color-status-done)' }} />
          ) : isError ? (
            <AlertCircle size={12} style={{ color: 'var(--color-status-failed)' }} />
          ) : processing ? (
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          ) : (
            <FileText size={12} style={{ color: 'var(--color-accent)' }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ color: 'var(--color-text-primary)' }}>
            <TruncatedTitle text={name} className="text-xs font-medium" />
          </p>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            <span>{formatBytes(size)}</span>
            {relativePath && <span className="truncate">{relativePath}</span>}
          </div>
        </div>
        {(processing || isDone || isError) ? (
          <div className="flex flex-col items-end gap-0.5 min-w-[5rem]">
            <div className="flex items-center gap-1.5 text-[10px]">
              <span
                className="tabular-nums"
                style={{ color: isError ? 'var(--color-status-failed)' : 'var(--color-text-secondary)' }}
              >
                {stageLabel(stage)}
              </span>
              <span className="tabular-nums font-medium" style={{ color: progressColor }}>
                {isDone ? 100 : Math.round(progress ?? 0)}%
              </span>
              {/* 耗时 */}
              {elapsed !== undefined && (
                <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                  {formatDuration(elapsed)}
                </span>
              )}
            </div>
            {/* 单文件进度条 */}
            {!stage?.includes('error') && !isDone && (
              <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-border-subtle)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(0, Math.min(100, progress ?? 0))}%`,
                    background: progressColor,
                  }}
                />
              </div>
            )}
            {error && (
              <span className="text-[9px] truncate max-w-[8rem]" style={{ color: 'var(--color-status-failed)' }}>
                {error}
              </span>
            )}
          </div>
        ) : (
          <>
            {onPreview && (
              <button
                onClick={onPreview}
                disabled={previewing}
                className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                style={{ color: 'var(--color-text-muted)' }}
                title="预览分块"
              >
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />}
              </button>
            )}
            {onRemove && (
              <button
                onClick={onRemove}
                className="p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                style={{ color: 'var(--color-status-failed)' }}
                title="移除"
              >
                <XCircle size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── 批量处理进度 ─────────────────────────────────────────────

function BatchProcessingIndicator() {
  const store = useRAGDetailStore()

  // 整体进度 = 已完成数 / 总数 + 活跃文件的平均进度占比
  const completedRatio = store.batchTotal > 0
    ? store.batchCompletedCount / store.batchTotal
    : 0
  const activeRatio = store.batchTotal > 0 && store.batchActiveFiles.length > 0
    ? store.batchActiveFiles.reduce((sum, f) => sum + (f.progress / 100), 0) / store.batchTotal
    : 0
  const overallProgress = Math.round((completedRatio + activeRatio) * 100)

  // 等待处理的文件数 = 当前仍处于 pending 状态的暂存文件
  const waitingCount = store.stagedFiles.filter(
    (f) => (store.stagedFileProgress[f.id]?.stage ?? 'pending') === 'pending'
  ).length

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-accent)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
            批量处理中 ({store.batchCompletedCount}/{store.batchTotal})
          </span>
        </div>
        <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--color-accent)' }}>
          {Math.min(overallProgress, 100)}%
        </span>
      </div>

      {/* 总进度条 */}
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(overallProgress, 100)}%`,
            background: 'var(--color-accent)',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* 活跃文件列表 */}
      {store.batchActiveFiles.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {store.batchActiveFiles.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <FileText size={10} style={{ color: 'var(--color-text-muted)' }} className="flex-shrink-0" />
              <span className="text-[11px] truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>
                {f.name}
              </span>
              <span className="text-[10px] flex-shrink-0 tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {stageLabel(f.stage)}
              </span>
              <span className="text-[10px] flex-shrink-0 tabular-nums font-medium" style={{ color: 'var(--color-accent)' }}>
                {f.progress}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 等待处理的文件数 */}
      {waitingCount > 0 && (
        <div className="flex items-center gap-2 pt-1.5" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
          <Clock size={11} style={{ color: 'var(--color-text-muted)' }} />
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            等待处理: {waitingCount} 个文件
          </span>
        </div>
      )}
    </div>
  )
}

// ─── 文档卡片 ─────────────────────────────────────────────────
function DocCard({
  doc,
  onDelete,
  onViewChunks,
  compactStatus,
  isNew,
}: {
  doc: DocumentInfo
  onDelete: () => void
  onViewChunks: () => void
  compactStatus?: boolean
  isNew?: boolean
}) {
  const s = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending
  const [hovered, setHovered] = useState(false)
  const isProcessing = doc.status === 'processing' || doc.status === 'pending'
  const isError = doc.status === 'error'

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
      style={{
        background: hovered ? 'var(--color-surface)' : 'transparent',
        border: isProcessing ? `1px solid ${s.color}40` : '1px solid transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 类型图标 */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: isError ? 'rgba(239,68,68,0.1)' : 'var(--color-accent-subtle)' }}
      >
        {isProcessing ? (
          <Loader2 size={14} className="animate-spin" style={{ color: s.color }} />
        ) : isError ? (
          <AlertCircle size={14} style={{ color: s.color }} />
        ) : (
          <FileText size={14} style={{ color: 'var(--color-accent)' }} />
        )}
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* 状态标签：新文档显示 NEW */}
          {isNew && doc.status === 'ready' ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
              style={{ background: '#ef444420', color: '#ef4444' }}>
              <Sparkles size={10} />
              NEW
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
              style={{ background: s.color + '20', color: s.color }}
            >
              {s.icon}
              {!(compactStatus && doc.status === 'ready') && s.label}
            </span>
          )}
          <h4 className="min-w-0 flex-1" style={{ color: 'var(--color-text-primary)' }}>
            <TruncatedTitle text={doc.name} className="text-xs font-medium" />
          </h4>
        </div>
        <p className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
          <span>{docTypeLabel(doc.type)}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>{formatBytes(doc.size)}</span>
          {doc.chunkCount !== undefined && doc.chunkCount > 0 && (
            <>
              <span className="mx-1.5 opacity-40">|</span>
              <span>{doc.chunkCount} 块</span>
            </>
          )}
          {doc.processedAt && (
            <>
              <span className="mx-1.5 opacity-40">|</span>
              <span>完成于 {formatTimeFull(doc.processedAt)}</span>
              {(() => {
                const dur = new Date(doc.processedAt!).getTime() - new Date(doc.uploadedAt).getTime()
                return dur > 0 ? <><span className="mx-1.5 opacity-40">|</span><span style={{ color: 'var(--color-accent)' }}>耗时 {formatDuration(dur)}</span></> : null
              })()}
            </>
          )}
        </p>
        {/* 错误信息 */}
        {isError && doc.error && (
          <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--color-status-failed)' }} title={doc.error}>
            {doc.error}
          </p>
        )}
      </div>

      {/* 操作 */}
      <div className={`flex items-center gap-1 transition-opacity ${isProcessing || isError ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {doc.status === 'ready' && (
          <button
            onClick={onViewChunks}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            title="查看分块"
          >
            <Layers size={12} />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--color-status-failed)' }}
          title="删除文档"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── 检索结果卡片 ─────────────────────────────────────────────
function SearchResultCard({ result, index }: { result: SearchResult; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const scorePercent = Math.round(result.score * 100)
  const isLong = result.chunk.content.length > 150

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
    >
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
            >
              {String(result.chunk.metadata?.source || result.chunk.documentId?.slice(0, 8))}
            </span>
            {result.chunk.metadata?.index != null && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-muted)' }}>
                #{String(result.chunk.metadata.index)}
              </span>
            )}
            {result.chunk.metadata?.tokenEstimate != null && (
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                ~{String(result.chunk.metadata.tokenEstimate)} tok
              </span>
            )}
          </div>
          <span
            className="text-xs font-medium tabular-nums"
            style={{ color: scorePercent >= 80 ? 'var(--color-status-done)' : scorePercent >= 60 ? 'var(--color-status-pending)' : 'var(--color-status-failed)' }}
          >
            {scorePercent}%
          </span>
        </div>

        {/* Content */}
        <p
          className={`text-xs leading-relaxed ${!expanded && isLong ? 'line-clamp-3' : ''}`}
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {result.chunk.content}
        </p>

        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] mt-2 flex items-center gap-1 transition-colors"
            style={{ color: 'var(--color-accent)' }}
          >
            {expanded ? <ChevronDown size={10} className="rotate-180" /> : <ChevronRight size={10} />}
            {expanded ? '收起' : '展开'}
          </button>
        )}
      </div>

      {/* Score bar */}
      <div className="h-0.5" style={{ background: 'var(--color-border-subtle)' }}>
        <div
          className="h-full"
          style={{
            width: `${scorePercent}%`,
            background: scorePercent >= 80 ? 'var(--color-status-done)' : scorePercent >= 60 ? 'var(--color-status-pending)' : 'var(--color-status-failed)',
          }}
        />
      </div>
    </div>
  )
}

// ─── 问答消息气泡 ─────────────────────────────────────────────
function ChatBubble({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[90%] sm:max-w-[80%] rounded-xl px-3 py-2.5"
        style={{
          background: isUser ? 'var(--color-accent)' : 'var(--color-surface)',
          border: isUser ? 'none' : '1px solid var(--color-border)',
        }}
      >
        {/* 用户消息 */}
        {isUser ? (
          <p className="text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-inverse)' }}>
            {msg.content}
          </p>
        ) : (
          <>
            {/* 来源标签 */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {msg.sources.map((s, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5"
                    style={{
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                    }}
                    title={`相关度: ${Math.round(s.score * 100)}%${s.tokenEstimate ? ` · ${s.tokenEstimate} tok` : ''}`}
                  >
                    <span className="opacity-60">[{i + 1}]</span>
                    {s.name}
                    {s.index != null && <span className="opacity-60">#{s.index}</span>}
                  </span>
                ))}
              </div>
            )}
            {/* 回答内容 */}
            <p className="text-xs whitespace-pre-wrap break-words leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
              {msg.content}
              {streaming && (
                <span
                  className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm"
                  style={{ background: 'var(--color-accent)' }}
                />
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── 主页面组件 ───────────────────────────────────────────────
const TABS = [
  { id: 'documents', label: '文档' },
  { id: 'search', label: '检索' },
  { id: 'chunks', label: '分块' },
  { id: 'chat', label: '问答' },
  { id: 'settings', label: '设置' },
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
  const [viewChunkList, setViewChunkList] = useState<ChunkPreview[]>([])
  const [viewChunkIndex, setViewChunkIndex] = useState(0)
  const [chunksDocFilter, setChunksDocFilter] = useState<string>('')
  const [chatInput, setChatInput] = useState('')
  const [uploadingFile, setUploadingFile] = useState<File | null>(null)
  const [editingKBInfo, setEditingKBInfo] = useState(false)
  const [infoCollapsed, setInfoCollapsed] = useState(false)
  // 预览激活时自动折叠基本信息
  const hasPreview = store.previewChunksLoading || store.previewChunks.length > 0
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (id) {
      store.fetchKnowledgeBase(id)
      store.fetchRAGConfig()
      // 先获取文档列表，再恢复批处理会话
      store.fetchDocuments(id).then(() => store.restoreBatchSession(id))
    }
    return () => { store.reset() }
  }, [id])

  // 预览激活时自动折叠基本信息
  useEffect(() => {
    if (hasPreview) setInfoCollapsed(true)
  }, [hasPreview])

  const handleUpload = useCallback(
    async (file: File) => {
      if (!id) return
      setUploadingFile(file)
      try {
        await store.uploadDocument(id, file)
      } finally {
        setUploadingFile(null)
      }
    },
    [id, store]
  )

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files)
      store.addStagedFiles(fileArray)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files)
      store.addStagedFiles(fileArray)
    }
    if (folderInputRef.current) folderInputRef.current.value = ''
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const fileArray = Array.from(files)
      store.addStagedFiles(fileArray)
    }
  }

  function handleSearch() {
    if (!searchInput.trim() || !id) return
    store.search(id, searchInput.trim())
  }

  async function handleDeleteDoc() {
    if (!deleteTarget || !id) return
    await store.deleteDocument(id, deleteTarget.docId)
    setDeleteTarget(null)
  }

  function handleViewChunks(docId: string) {
    if (!id) return
    setActiveTab('chunks')
    setChunksDocFilter(docId)
    store.fetchChunks(id, docId)
  }

  // 自动滚动到最新消息
  useEffect(() => {
    if (store.chatMessages.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [store.chatMessages])

  async function handleSendChat() {
    if (!chatInput.trim() || !id || store.chatStreaming) return
    const question = chatInput.trim()
    setChatInput('')
    await store.sendChat(id, question)
  }

  // 加载状态
  if (store.kbLoading && !store.kb) {
    return (
      <div className="p-6 w-full">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded" style={{ background: 'var(--color-surface)' }} />
          <div className="h-12 w-full rounded" style={{ background: 'var(--color-surface)' }} />
        </div>
      </div>
    )
  }

  // 未找到
  if (!store.kb && !store.kbLoading) {
    return (
      <div className="p-6 text-center">
        <FileWarning size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>知识库不存在</p>
        <button
          onClick={() => navigate('/rag')}
          className="inline-flex items-center gap-1 text-xs transition-colors"
          style={{ color: 'var(--color-accent)' }}
        >
          <ArrowLeft size={12} />
          返回列表
        </button>
      </div>
    )
  }

  const kb = store.kb!

  return (
    <div className="h-screen w-full flex flex-col lg:flex-row gap-5 p-4 sm:p-6 overflow-hidden">
      {/* ═══ 左侧：主内容区 ═══ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* ── 头部 ─────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 flex-shrink-0">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => navigate('/rag')}
              className="flex items-center gap-1 text-xs transition-colors"
              style={{ color: 'var(--color-text-muted)' }}
            >
              <ArrowLeft size={12} />
              返回
            </button>
            <div className="w-px h-4 hidden sm:block" style={{ background: 'var(--color-border)' }} />
            <h1 className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {kb.name}
            </h1>
            <button
              onClick={() => setEditingKBInfo(true)}
              className="p-1 rounded-md transition-colors"
              style={{ color: 'var(--color-text-muted)', background: 'transparent' }}
              title="编辑知识库信息"
            >
              <Edit2 size={12} />
            </button>
            {kb.config.embeddingConfig?.provider === 'local' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                Ollama
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            <span className="flex items-center gap-1"><FileText size={10} />{kb.documentCount}</span>
            <span className="flex items-center gap-1"><Layers size={10} />{kb.chunkCount}</span>
          </div>
        </div>

        {/* ── Tab 导航 ─────────────────────────────────────── */}
        <div
          className="flex flex-wrap gap-1 p-1 rounded-lg mb-4 flex-shrink-0"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
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
          className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2 flex-shrink-0"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            color: 'var(--color-status-failed)',
          }}
        >
          <AlertCircle size={12} />
          <span className="flex-1">{store.kbError || store.docsError || store.uploadError}</span>
          <button
            onClick={() => useRAGDetailStore.setState({ kbError: null, docsError: null, uploadError: null })}
            className="p-0.5 rounded"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          文档管理 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'documents' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* 上传区域 */}
          <div
            className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors flex-shrink-0 ${
              store.batchProcessing ? 'pointer-events-none opacity-60' : ''
            }`}
            style={{
              borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
              background: dragOver ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
            }}
            onDragOver={(e) => { e.preventDefault(); if (!store.batchProcessing) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { if (!store.batchProcessing) onDrop(e) }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,.html,.json,.xml"
              onChange={onFileSelect}
            />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              directory=""
              onChange={onFolderSelect}
            />

            {store.uploadStage !== null && !store.batchProcessing ? (
              <ProcessingIndicator
                fileName={uploadingFile?.name || '正在上传...'}
                stage={store.uploadStage}
                progress={store.uploadProgress ?? 0}
                message={store.uploadMessage}
                chunkCount={store.uploadChunkCount}
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: 'var(--color-accent)',
                      color: 'var(--color-text-inverse)',
                    }}
                  >
                    <Upload size={12} />
                    选择文件
                  </button>
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: 'transparent',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <FolderUp size={12} />
                    上传文件夹
                  </button>
                </div>
                <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  支持多文件选择、拖拽或上传整个文件夹 · PDF、DOCX、TXT 等，单个最大 50MB
                </p>
              </div>
            )}
          </div>

          {/* 批量处理完成提示 */}
          {store.batchDone && !store.batchProcessing && (
            <div
              className="rounded-lg px-3 py-2 flex items-center gap-2 text-xs flex-shrink-0"
              style={{
                background: store.batchErrors.length > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                color: store.batchErrors.length > 0 ? 'var(--color-status-failed)' : 'var(--color-status-done)',
              }}
            >
              {store.batchErrors.length > 0 ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
              <span className="flex-1">
                {store.batchErrors.length > 0
                  ? `处理完成，${store.batchErrors.length} 个文件失败: ${store.batchErrors[0]}`
                  : `全部 ${store.batchTotal} 个文件处理完成`}
              </span>
              <button onClick={() => useRAGDetailStore.setState({ batchDone: false })} className="p-0.5">
                <X size={10} />
              </button>
            </div>
          )}

          {/* ═══════════ 两栏布局：已处理 | 处理中 ═══════════ */}
          <div className="flex-1 min-h-0 flex flex-col gap-3" style={{ overflowY: 'auto' }}>

          {/* ─── 全宽行：解析配置 + 处理按钮 ─── */}
          {!store.batchProcessing && store.stagedFiles.length > 0 && (
            <div className="flex-shrink-0 space-y-2">
              <ChunkingConfigPanel kbId={id} />
              <button
                onClick={async () => {
                  if (!id) return
                  store.updateChunkingConfig({})
                  const available = await store.checkEmbeddingHealth(id)
                  if (!available) return
                  store.processStagedFiles(id)
                }}
                disabled={store.stagedFiles.length === 0 || store.embeddingChecking}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}
              >
                {store.embeddingChecking ? <><Loader2 size={12} className="animate-spin" />检测向量模型...</> : <><Play size={12} />处理全部 ({store.stagedFiles.length} 个文件)</>}
              </button>
              {store.embeddingCheckResult && !store.embeddingCheckResult.available && (
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded text-[11px]" style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--color-text-primary)' }}>
                  <AlertCircle size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--color-danger, #ef4444)' }} />
                  <span>向量模型不可用：{store.embeddingCheckResult.error || '未知错误'}<br />请检查 Embedding 配置或确认 Ollama 服务已启动。</span>
                </div>
              )}
              {store.embeddingCheckResult?.available && (
                <div className="flex items-center gap-1 px-2 py-1 rounded text-[11px]" style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', color: 'var(--color-text-primary)' }}>
                  <CheckCircle2 size={12} style={{ color: 'var(--color-success, #22c55e)' }} />向量模型可用（{store.embeddingCheckResult.model}，{store.embeddingCheckResult.dimensions}维）
                </div>
              )}
            </div>
          )}

          {/* ─── 左右两栏：已处理 | 处理中 ─── */}
          <div className={`flex-1 min-h-0 grid ${store.stagedFiles.length > 0 ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>

            {/* 左栏：已处理完成 */}
            <div className="flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-1.5 mb-2 flex-shrink-0">
                <CheckCircle2 size={11} style={{ color: 'var(--color-status-done)' }} />
                <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>已处理完成</span>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--color-text-muted)' }}>({store.documents.filter(d => d.status === 'ready').length})</span>
              </div>
              {store.docsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />)}
                </div>
              ) : store.documents.filter(d => d.status === 'ready').length === 0 ? (
                <div className="text-center py-10 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <FileText size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无文档，上传文件以构建知识库</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                  {(() => {
                    const readyDocs = store.documents.filter((d) => d.status === 'ready')
                    const sorted = [...readyDocs].sort((a, b) => {
                      if (!a.processedAt && !b.processedAt) return 0
                      if (!a.processedAt) return 1
                      if (!b.processedAt) return -1
                      return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime()
                    })
                    return sorted.map((doc) => (
                      <div key={doc.id} className="relative">
                        <DocCard
                          doc={doc}
                          isNew={store.newDocIds.includes(doc.id)}
                          onDelete={() => setDeleteTarget({ docId: doc.id, name: doc.name })}
                          onViewChunks={() => handleViewChunks(doc.id)}
                          compactStatus={store.stagedFiles.length > 0}
                        />
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>

            {/* 右栏：处理中 + 等待 */}
            {store.stagedFiles.length > 0 && (
              <div className="flex flex-col min-h-0 overflow-hidden space-y-3">
                {/* ─── 处理中队列 ─── */}
                {store.stagedFiles.filter((f) => {
                  const s = store.stagedFileProgress[f.id]?.stage
                  return s !== undefined && s !== null && s !== 'pending' && s !== 'done' && s !== 'error'
                }).sort(
                  (a, b) => (store.stagedFileProgress[a.id]?.startTime ?? 0) - (store.stagedFileProgress[b.id]?.startTime ?? 0)
                ).length > 0 && (
                  <div className="flex-shrink-0 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Loader2 size={11} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                      <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>处理中队列</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium tabular-nums" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                        {store.stagedFiles.filter((f) => {
                          const s = store.stagedFileProgress[f.id]?.stage
                          return s !== undefined && s !== null && s !== 'pending' && s !== 'done' && s !== 'error'
                        }).length}
                      </span>
                    </div>
                    <div className="rounded-lg p-2 space-y-1 max-h-56 overflow-y-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-accent)' }}>
                      {store.stagedFiles.filter((f) => {
                        const s = store.stagedFileProgress[f.id]?.stage
                        return s !== undefined && s !== null && s !== 'pending' && s !== 'done' && s !== 'error'
                      }).sort(
                        (a, b) => (store.stagedFileProgress[a.id]?.startTime ?? 0) - (store.stagedFileProgress[b.id]?.startTime ?? 0)
                      ).map((sf) => (
                        <StagedFileItem
                          key={sf.id}
                          name={sf.name}
                          size={sf.size}
                          relativePath={sf.relativePath}
                          stage={store.stagedFileProgress[sf.id]?.stage}
                          progress={store.stagedFileProgress[sf.id]?.progress}
                          error={store.stagedFileProgress[sf.id]?.error}
                          startTime={store.stagedFileProgress[sf.id]?.startTime}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── 等待处理 ─── */}
                {store.stagedFiles.filter(
                  (f) => (store.stagedFileProgress[f.id]?.stage ?? 'pending') === 'pending'
                ).length > 0 && (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="flex items-center justify-between mb-1 flex-shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Clock size={11} style={{ color: 'var(--color-text-muted)' }} />
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>等待处理</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium tabular-nums" style={{ background: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                          {store.stagedFiles.filter(
                            (f) => (store.stagedFileProgress[f.id]?.stage ?? 'pending') === 'pending'
                          ).length} 个文件
                        </span>
                      </div>
                      {!store.batchProcessing && (
                        <button onClick={() => store.clearStagedFiles()} className="text-[10px] flex items-center gap-1 transition-colors" style={{ color: 'var(--color-text-muted)' }}>
                          <X size={10} />清空
                        </button>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 rounded-lg p-2 space-y-1 overflow-y-auto" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                      {store.stagedFiles.filter(
                        (f) => (store.stagedFileProgress[f.id]?.stage ?? 'pending') === 'pending'
                      ).map((sf) => (
                        <StagedFileItem
                          key={sf.id}
                          name={sf.name}
                          size={sf.size}
                          relativePath={sf.relativePath}
                          stage={'pending'}
                          onRemove={store.batchProcessing ? undefined : () => store.removeStagedFile(sf.id)}
                          onPreview={id && !store.batchProcessing ? () => store.fetchChunkPreview(id, sf.file) : undefined}
                          previewing={store.previewChunksLoading && store.previewChunksFileName === sf.name}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>{/* end grid */}
          </div>{/* end zones wrapper */}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          检索测试 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'search' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* 搜索栏 */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg flex-shrink-0"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <Search size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              placeholder="输入检索关键词..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
              className="flex-1 bg-transparent text-xs outline-none"
              style={{ color: 'var(--color-text-primary)' }}
            />
            <button
              onClick={handleSearch}
              disabled={!searchInput.trim() || store.searchLoading}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-text-inverse)',
              }}
            >
              {store.searchLoading ? <Loader2 size={10} className="animate-spin" /> : '检索'}
            </button>
          </div>

          {/* 检索结果 */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {store.searchQuery && !store.searchLoading && (
              <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                「{store.searchQuery}」找到 {store.searchResults.length} 条结果
              </p>
            )}

            {store.searchError && (
              <p className="text-xs" style={{ color: 'var(--color-status-failed)' }}>{store.searchError}</p>
            )}

            {store.searchLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
                ))}
              </div>
            ) : store.searchResults.length > 0 ? (
              <div className="space-y-2">
                {store.searchResults.map((r, i) => (
                  <SearchResultCard key={i} result={r} index={i} />
                ))}
              </div>
            ) : store.searchQuery ? (
              <div className="text-center py-8 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <Search size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>未找到匹配结果</p>
              </div>
            ) : (
              <div className="text-center py-8 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <FileSearch size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>输入关键词测试检索效果</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          分块预览 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'chunks' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* 文档选择器 */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <Select
              value={chunksDocFilter}
              onValueChange={(docId) => {
                setChunksDocFilter(docId)
                if (docId && id) store.fetchChunks(id, docId)
              }}
            >
              <SelectTrigger className="flex-1 max-w-xs h-8 text-xs bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-primary)] focus:ring-[var(--color-accent)]">
                <SelectValue placeholder="选择文档..." />
              </SelectTrigger>
              <SelectContent className="bg-[var(--color-surface-elevated)] border-[var(--color-border)]">
                {store.documents.filter((d) => d.status === 'ready').map((doc) => (
                  <SelectItem
                    key={doc.id}
                    value={doc.id}
                    className="text-xs text-[var(--color-text-primary)] focus:bg-[var(--color-accent-subtle)] focus:text-[var(--color-accent)]"
                    title={doc.name}
                  >
                    <span className="truncate block max-w-[220px]">{doc.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {store.chunksTotal > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                共 {store.chunksTotal} 个分块
              </span>
            )}
          </div>

          {/* 分块列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {store.chunksLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
                ))}
              </div>
            ) : store.chunksError ? (
              <p className="text-xs" style={{ color: 'var(--color-status-failed)' }}>{store.chunksError}</p>
            ) : store.chunks.length > 0 ? (
              <div className="space-y-1">
                {store.chunks.map((chunk, i) => {
                  const meta = chunk.metadata || {}
                  return (
                  <div
                    key={chunk.id}
                    className="rounded-lg p-3 cursor-pointer transition-colors"
                    style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                    }}
                    onClick={() => { setViewChunkList(store.chunks); setViewChunkIndex(i) }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                          style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                        >
                          #{meta.index ?? i + 1}
                        </span>
                        {meta.source && (
                          <span className="text-[10px] truncate max-w-[120px]" style={{ color: 'var(--color-text-muted)' }}>
                            {meta.source as string}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                        ~{meta.tokenEstimate ?? Math.ceil(chunk.content.length / 4)} tok
                      </span>
                    </div>
                    <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {chunk.content}
                    </p>
                  </div>
                  )
                })}
              </div>
            ) : chunksDocFilter ? (
              <div className="text-center py-8 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>未找到分块数据</p>
              </div>
            ) : (
              <div className="text-center py-8 rounded-lg" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <Layers size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>选择文档查看分块</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          知识问答 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'chat' && (
        <div className="flex flex-col flex-1 min-h-0 gap-3">
          {/* 顶部操作栏 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* 模型选择器 */}
              {store.llmProfiles.length > 0 && (
                <Select
                  value={store.chatModelId || ''}
                  onValueChange={(v) => useRAGDetailStore.setState({ chatModelId: v || null })}
                >
                  <SelectTrigger className="h-7 text-[11px] min-w-0 w-full sm:min-w-[140px] sm:w-auto bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-primary)] focus:ring-[var(--color-accent)]">
                    <SelectValue placeholder="系统默认模型" />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--color-surface-elevated)] border-[var(--color-border)]">
                    <SelectItem value="" className="text-[11px] text-[var(--color-text-primary)]">系统默认</SelectItem>
                    {store.llmProfiles.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        className="text-[11px] text-[var(--color-text-primary)] focus:bg-[var(--color-accent-subtle)] focus:text-[var(--color-accent)]"
                      >
                        {p.name} ({p.model})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {store.chatMessages.length > 0 && (
                <button
                  onClick={store.clearChat}
                  className="flex items-center justify-center gap-1 text-[10px] px-2 py-1.5 rounded transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <RefreshCw size={10} />
                  清空
                </button>
              )}
            </div>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {store.chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-center px-4">
                <MessageSquare size={28} className="mb-3" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs sm:text-sm mb-1" style={{ color: 'var(--color-text-primary)' }}>知识库问答</p>
                <p className="text-[10px] sm:text-xs max-w-xs" style={{ color: 'var(--color-text-muted)' }}>
                  基于知识库内容回答你的问题，支持流式输出
                </p>
              </div>
            ) : (
              <>
                {store.chatMessages.map((msg, i) => (
                  <ChatBubble key={i} msg={msg} streaming={i === store.chatMessages.length - 1 && store.chatStreaming && msg.role === 'assistant'} />
                ))}
                <div ref={chatEndRef} />
              </>
            )}
          </div>

          {/* 输入区域 */}
          <div className="flex-shrink-0">
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <input
                type="text"
                placeholder="输入问题，基于知识库回答..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat() } }}
                disabled={store.chatStreaming}
                className="flex-1 min-w-0 bg-transparent text-xs sm:text-sm outline-none disabled:opacity-50"
                style={{ color: 'var(--color-text-primary)' }}
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim() || store.chatStreaming}
                className="px-3 py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-50 h-8 flex items-center justify-center min-w-[56px]"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-inverse)',
                }}
              >
                {store.chatStreaming ? <Loader2 size={12} className="animate-spin" /> : '发送'}
              </button>
            </div>
            {store.chatError && (
              <p className="text-[10px] sm:text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--color-status-failed)' }}>
                <AlertCircle size={10} />
                {store.chatError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          向量模型 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'settings' && (
        <div className="space-y-4 max-w-lg">
          <EmbeddingSettingsPanel kb={store.kb} ragConfig={store.ragConfig} />
          <div>
            <h3 className="text-xs font-medium mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              <Scissors size={12} />
              分块配置
            </h3>
            <ChunkingConfigPanel kbId={id} />
          </div>
        </div>
      )}

      {/* ── 弹窗 ─────────────────────────────────────────── */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除文档"
        message={deleteTarget ? `确定要删除「${deleteTarget.name}」吗？此操作不可恢复。` : ''}
        onConfirm={handleDeleteDoc}
        onClose={() => setDeleteTarget(null)}
      />

      <ChunkViewerModal
        open={viewChunkList.length > 0}
        chunks={viewChunkList}
        currentIndex={viewChunkIndex}
        onClose={() => { setViewChunkList([]); setViewChunkIndex(0) }}
        onNavigate={setViewChunkIndex}
      />
      </div>{/* end left content */}

      {/* ═══ 右侧：基本信息侧边栏 ═══ */}
      <aside className="lg:w-60 xl:w-72 shrink-0 flex flex-col gap-3">
        <div
          className="rounded-lg p-4 lg:sticky lg:top-4"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <button
            className="w-full flex items-center justify-between gap-1.5 text-xs font-medium"
            style={{ color: 'var(--color-text-muted)' }}
            onClick={() => setInfoCollapsed(!infoCollapsed)}
          >
            <span className="flex items-center gap-1.5">
              <Info size={10} />
              基本信息
            </span>
            {infoCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          {!infoCollapsed && (
            <div className="space-y-3 mt-3">
              <InfoItem label="知识库编码" value={kb.id} mono />
              <InfoItem label="描述" value={kb.description || '—'} />
              <InfoItem
                label="Embedding 模型"
                value={
                  kb.config.embeddingConfig?.model
                    || (kb.config.embeddingConfig?.provider
                      ? `${kb.config.embeddingConfig.provider === 'openai' ? 'OpenAI' : 'Ollama'} (默认)`
                      : '系统默认')
                }
              />
              <InfoItem label="向量维度" value={String(kb.config.dimensions)} />
              <InfoItem label="相似度阈值" value={String(kb.config.similarityThreshold)} />
              <InfoItem label="Top-K" value={String(kb.config.topK)} />
              <InfoItem label="创建时间" value={kb.createdAt} time />
              <InfoItem label="更新时间" value={kb.updatedAt} time />
              <InfoItem label="存储引擎" value={kb.providerId} />
            </div>
          )}
        </div>

        {/* 分块预览（在暂存文件上右键预览时显示） */}
        {(store.previewChunksLoading || store.previewChunks.length > 0) && (
          <div
            className="rounded-lg p-3 flex-1 min-h-0 flex flex-col"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              marginTop: '0.75rem',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Layers size={11} className="shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--color-text-secondary)' }}>预览:</span>
                <span className="min-w-0 flex-1">
                  <TruncatedTitle text={store.previewChunksFileName || '解析中...'} className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }} />
                </span>
                {store.previewChunks.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                    {store.previewChunks.length} 块
                  </span>
                )}
              </div>
              {store.previewChunks.length > 0 && (
                <button onClick={() => store.clearPreviewChunks()} className="p-0.5 rounded" style={{ color: 'var(--color-text-muted)' }}><X size={11} /></button>
              )}
            </div>
            {store.previewChunksLoading && (
              <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                <Loader2 size={12} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                正在解析并预览分块...
              </div>
            )}
            {store.previewChunksError && (
              <div className="text-[11px]" style={{ color: 'var(--color-status-failed)' }}>{store.previewChunksError}</div>
            )}
            {!store.previewChunksLoading && store.previewChunks.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {store.previewChunks.map((chunk, i) => (
                  <div
                    key={chunk.id}
                    className="rounded-lg p-2 cursor-pointer transition-colors hover:bg-[var(--color-accent-subtle)]"
                    onClick={() => { setViewChunkList(store.previewChunks); setViewChunkIndex(i) }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] px-1 py-0.5 rounded font-mono font-medium" style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>#{chunk.metadata?.index ?? i}</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>~{chunk.metadata?.tokenEstimate ?? Math.ceil(chunk.content.length / 4)} tok</span>
                    </div>
                    <p className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{chunk.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ── 编辑知识库信息弹窗 ──────────────────────────── */}
      <EditKBInfoModal
        open={editingKBInfo}
        name={kb.name}
        description={kb.description || ''}
        saving={store.kbSaving}
        onClose={() => { setEditingKBInfo(false); useRAGDetailStore.setState({ kbSaveError: null }) }}
        onSave={async (name, description) => {
          const ok = await store.updateKBInfo(kb.id, { name, description })
          if (ok) setEditingKBInfo(false)
        }}
      />
    </div>
  )
}
