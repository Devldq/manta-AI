import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDiff, RefreshCw } from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'
import { ReadonlyCodeEditor } from './ReadonlyCodeEditor'

interface ReviewFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
}

interface ReviewResponse {
  repository: boolean
  root: string
  clean?: boolean
  files: ReviewFile[]
  diff: string
  truncated: boolean
}

const KIND_LABELS: Record<ReviewFile['kind'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
}

export function ReviewTab({ workspaceId }: SessionSidebarContext) {
  const [review, setReview] = useState<ReviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)

  const loadReview = useCallback(async () => {
    if (!workspaceId) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/workspace-sidebar/review?${new URLSearchParams({ workspaceId })}`, {
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法读取工作区变更')
      setReview(data)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : '无法读取工作区变更')
      }
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadReview()
    return () => requestRef.current?.abort()
  }, [loadReview])

  if (!workspaceId) {
    return <PanelEmpty title="未选择工作区" description="选择一个绑定本地目录的工作区后，即可审阅 Git 变更。" />
  }
  if (loading && !review) return <PanelLoading label="正在读取工作区变更…" />
  if (error && !review) return <PanelError message={error} action={<RetryButton onClick={() => void loadReview()} />} />
  if (!review) return null
  if (!review.repository) {
    return <PanelEmpty title="不是 Git 工作区" description="当前目录没有可用的 Git 仓库，审阅面板不会伪造变更。" />
  }

  return (
    <div className="workspace-review">
      <div className="workspace-panel-toolbar">
        <div className="workspace-panel-toolbar-copy">
          <strong>{review.clean ? '工作区干净' : `${review.files.length} 个变更`}</strong>
          <span title={review.root}>{review.root}</span>
        </div>
        <button
          type="button"
          className="workspace-icon-button"
          onClick={() => void loadReview()}
          disabled={loading}
          aria-label="刷新工作区变更"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'tool-spinner' : undefined} />
        </button>
      </div>

      {review.clean ? (
        <PanelEmpty title="没有待审阅变更" description="工作区与当前 Git 基线一致。" />
      ) : (
        <>
          <div className="workspace-review-files" aria-label="变更文件">
            {review.files.map((file) => (
              <div className="workspace-review-file" key={`${file.indexStatus}${file.worktreeStatus}:${file.path}`}>
                <span className={`workspace-review-kind is-${file.kind}`}>{KIND_LABELS[file.kind]}</span>
                <span title={file.path}>{file.path}</span>
              </div>
            ))}
          </div>
          <div className="workspace-review-diff-heading">
            <FileDiff size={13} aria-hidden="true" />
            <span>差异预览</span>
            <small>{review.truncated ? '只读 · 已截断' : '只读'}</small>
          </div>
          {review.diff ? (
            <ReadonlyCodeEditor
              value={review.diff}
              language="diff"
              ariaLabel="只读 Git 差异"
            />
          ) : (
            <div className="workspace-review-note">未跟踪文件会列在上方；加入 Git 后可查看行级差异。</div>
          )}
        </>
      )}
    </div>
  )
}
