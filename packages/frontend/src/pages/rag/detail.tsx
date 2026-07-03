/* 知识库详情页 — /rag/:id
 * 设计方向：与项目整体风格对齐，克制、精致、轻量
 */
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
  FileSearch,
  MessageSquare,
  RefreshCw,
  Info,
} from 'lucide-react'
import {
  useRAGDetailStore,
  type DocumentInfo,
  type ChunkPreview,
  type SearchResult,
  type RAGConfig,
  type ChatMessage,
  type LLMProfileOption,
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
  const [copied, setCopied] = useState(false)

  async function copyContent() {
    if (!chunk) return
    await navigator.clipboard.writeText(chunk.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open || !chunk) return null

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
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>#{chunk.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center gap-1">
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

          {Object.keys(chunk.metadata).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-medium mb-1.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                <Hash size={10} />
                元数据
              </p>
              <pre
                className="text-[10px] whitespace-pre-wrap p-2 rounded-lg"
                style={{
                  color: 'var(--color-text-secondary)',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-subtle)',
                }}
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
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
      style={{
        background: hovered ? 'var(--color-surface)' : 'transparent',
        border: '1px solid transparent',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 类型图标 */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: 'var(--color-accent-subtle)' }}
      >
        <FileText size={14} style={{ color: 'var(--color-accent)' }} />
      </div>

      {/* 信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
            {doc.name}
          </h4>
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
            style={{ background: s.color + '20', color: s.color }}
          >
            {s.icon}
            {s.label}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          <span>{docTypeLabel(doc.type)}</span>
          <span>{formatBytes(doc.size)}</span>
          {doc.chunkCount !== undefined && <span>{doc.chunkCount} 块</span>}
          <span>{formatTime(doc.uploadedAt)}</span>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
            >
              {result.chunk.metadata?.source || result.chunk.documentId?.slice(0, 8)}
            </span>
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
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                    }}
                  >
                    {s.name}
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
  { id: 'settings', label: '模型' },
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
  const [chatInput, setChatInput] = useState('')
  const [uploadingFile, setUploadingFile] = useState<File | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (id) {
      store.fetchKnowledgeBase(id)
      store.fetchDocuments(id)
      store.fetchRAGConfig()
    }
    return () => { store.reset() }
  }, [id])

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
    <div className="min-h-full w-full flex flex-col lg:flex-row gap-5 p-4 sm:p-6">
      {/* ═══ 左侧：主内容区 ═══ */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* ── 头部 ─────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
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
          className="flex flex-wrap gap-1 p-1 rounded-lg mb-4"
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
          className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
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
        <div className="space-y-3">
          {/* 上传区域 */}
          <div
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
              dragOver ? '' : ''
            } ${store.uploadStage !== null ? 'pointer-events-none opacity-80' : ''}`}
            style={{
              borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
              background: dragOver ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
            }}
            onDragOver={(e) => { e.preventDefault(); if (!store.uploadStage) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { if (!store.uploadStage) onDrop(e) }}
            onClick={() => { if (!store.uploadStage) fileInputRef.current?.click() }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.docx,.xlsx,.pptx,.html,.json,.xml"
              onChange={onFileSelect}
            />

            {store.uploadStage !== null ? (
              <ProcessingIndicator
                fileName={uploadingFile?.name || '正在上传...'}
                stage={store.uploadStage}
                progress={store.uploadProgress ?? 0}
                message={store.uploadMessage}
                chunkCount={store.uploadChunkCount}
              />
            ) : (
              <>
                <Upload size={16} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-xs mb-1" style={{ color: 'var(--color-text-primary)' }}>拖拽文件或点击上传</p>
                <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>PDF、DOCX、TXT 等，最大 50MB</p>
              </>
            )}
          </div>

          {/* 文档列表 */}
          {store.docsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'var(--color-surface)' }} />
              ))}
            </div>
          ) : store.documents.length === 0 ? (
            <div
              className="text-center py-10 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <FileText size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>暂无文档，上传文件以构建知识库</p>
            </div>
          ) : (
            <div className="space-y-1">
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
        <div className="space-y-3">
          {/* 搜索栏 */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
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
      )}

      {/* ══════════════════════════════════════════════════
          分块预览 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'chunks' && (
        <div className="space-y-3">
          {/* 文档选择器 */}
          <div className="flex items-center gap-3">
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
                  >
                    {doc.name}
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
              {store.chunks.map((chunk, i) => (
                <div
                  key={chunk.id}
                  className="rounded-lg p-3 cursor-pointer transition-colors"
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                  onClick={() => setViewChunk(chunk)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                      style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}
                    >
                      #{i + 1}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      {chunk.content.length} 字符
                    </span>
                  </div>
                  <p className="text-xs line-clamp-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {chunk.content}
                  </p>
                </div>
              ))}
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
      )}

      {/* ══════════════════════════════════════════════════
          知识问答 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'chat' && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* 顶部操作栏 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 flex-shrink-0">
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
          <div className="flex-shrink-0 mt-3">
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
        <div>
          <EmbeddingSettingsPanel kb={store.kb} ragConfig={store.ragConfig} />
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

      <ChunkViewerModal open={!!viewChunk} chunk={viewChunk} onClose={() => setViewChunk(null)} />
      </div>{/* end left content */}

      {/* ═══ 右侧：基本信息侧边栏 ═══ */}
      <aside className="lg:w-60 xl:w-72 shrink-0">
        <div
          className="rounded-lg p-4 lg:sticky lg:top-4"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <h2 className="text-xs font-medium mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
            <Info size={10} />
            基本信息
          </h2>
          <div className="space-y-3">
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
        </div>
      </aside>
    </div>
  )
}
