import { useEffect, useState } from 'react'
import { AlertCircle, FileText, Loader2, X } from 'lucide-react'

interface Conversation {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  messages: Array<{
    id: string
    role: string
    content: string
    timestamp: string
  }>
}

interface FilePreview {
  kind: 'text' | 'image'
  path: string
  size: number
  content: string
  mimeType?: string
}

interface SessionSidebarProps {
  open: boolean
  conversation: Conversation | null
  workspaceId?: string | null
  previewPath?: string | null
  onClose?: () => void
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SessionSidebar({ open, conversation, workspaceId, previewPath, onClose }: SessionSidebarProps) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !previewPath) {
      setPreview(null)
      setError('')
      return
    }
    if (!workspaceId) {
      setPreview(null)
      setError('请先选择工作区，才能预览本地文件。')
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setPreview(null)
    setError('')
    const query = new URLSearchParams({ workspaceId, path: previewPath })
    fetch(`/api/fs/preview?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '无法读取文件')
        return data as FilePreview
      })
      .then(setPreview)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '无法读取文件')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, previewPath, workspaceId])

  if (!open) return null

  const title = previewPath ? '文件预览' : '会话详情'

  return (
    <aside className="session-sidebar" aria-label={title}>
      <header className="session-sidebar-header">
        <div className="session-sidebar-title">
          {previewPath && <FileText size={15} />}
          <span>{title}</span>
        </div>
        {onClose && (
          <button type="button" className="session-sidebar-close" onClick={onClose} aria-label="关闭侧边栏">
            <X size={15} />
          </button>
        )}
      </header>

      {previewPath ? (
        <div className="file-preview">
          <div className="file-preview-meta">
            <span title={preview?.path || previewPath}>{preview?.path || previewPath}</span>
            {preview && <small>{formatBytes(preview.size)}</small>}
          </div>
          {loading && (
            <div className="file-preview-status"><Loader2 size={15} className="tool-spinner" />正在读取文件…</div>
          )}
          {error && (
            <div className="file-preview-status is-error"><AlertCircle size={15} />{error}</div>
          )}
          {preview?.kind === 'image' && (
            <div className="file-preview-image-wrap">
              <img src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.path} />
            </div>
          )}
          {preview?.kind === 'text' && <pre className="file-preview-code"><code>{preview.content}</code></pre>}
        </div>
      ) : (
        <div className="session-sidebar-details">
          {conversation ? (
            <dl>
              <div><dt>标题</dt><dd>{conversation.title}</dd></div>
              <div><dt>Agent</dt><dd>{conversation.agentName}</dd></div>
              <div><dt>消息数</dt><dd>{conversation.messages?.length ?? 0}</dd></div>
            </dl>
          ) : (
            <p>暂无会话信息</p>
          )}
        </div>
      )}
    </aside>
  )
}
