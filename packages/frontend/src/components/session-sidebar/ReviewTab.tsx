import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignJustify,
  Columns2,
  Eye,
  EyeOff,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  UploadCloud,
} from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'
import { ReadonlyCodeEditor, ReadonlyDiffEditor } from './ReadonlyCodeEditor'

interface ReviewFile {
  path: string
  previousPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
}

interface ReviewResponse {
  repository: boolean
  root: string
  clean?: boolean
  files: ReviewFile[]
  counts: Record<ReviewFile['kind'], number>
  branch: {
    name: string
    detached: boolean
    upstream?: string
    ahead: number
    behind: number
    hasRemote: boolean
  }
  stats: {
    additions: number
    deletions: number
  }
  truncated: boolean
}

interface FileDiffResponse {
  path: string
  previousPath?: string
  unified: string
  original: string
  modified: string
  binary: boolean
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
  const [selectedPath, setSelectedPath] = useState('')
  const [fileDiff, setFileDiff] = useState<FileDiffResponse | null>(null)
  const [diffMode, setDiffMode] = useState<'unified' | 'split'>('split')
  const [filesVisible, setFilesVisible] = useState(true)
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [loading, setLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<'commit' | 'commit-push' | 'push' | ''>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const fileRequestRef = useRef<AbortController | null>(null)

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
      const nextReview = data as ReviewResponse
      setReview(nextReview)
      setSelectedPath((current) => {
        if (current && nextReview.files.some((file) => file.path === current)) return current
        return nextReview.files[0]?.path || ''
      })
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : '无法读取工作区变更')
      }
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoading(false)
    }
  }, [workspaceId])

  const loadFileDiff = useCallback(async (path: string) => {
    if (!workspaceId || !path) {
      setFileDiff(null)
      return
    }
    fileRequestRef.current?.abort()
    const controller = new AbortController()
    fileRequestRef.current = controller
    setFileLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/workspace-sidebar/review/file?${new URLSearchParams({ workspaceId, path })}`, {
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法读取文件差异')
      setFileDiff(data)
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : '无法读取文件差异')
      }
    } finally {
      if (!controller.signal.aborted && fileRequestRef.current === controller) setFileLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadReview()
    return () => requestRef.current?.abort()
  }, [loadReview])

  useEffect(() => {
    void loadFileDiff(selectedPath)
    return () => fileRequestRef.current?.abort()
  }, [loadFileDiff, selectedPath])

  async function runReviewAction(action: 'commit' | 'commit-push' | 'push') {
    if (!workspaceId) return
    setBusyAction(action)
    setError('')
    setNotice('')
    try {
      const commit = action !== 'push'
      const response = await fetch(
        commit ? '/api/workspace-sidebar/review/commit' : '/api/workspace-sidebar/review/push',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(commit
            ? {
                workspaceId,
                message: commitMessage,
                includeUnstaged,
                push: action === 'commit-push',
              }
            : { workspaceId }),
        },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Git 操作失败')
      setNotice(action === 'commit' ? '提交成功' : action === 'commit-push' ? '提交并推送成功' : '推送成功')
      if (commit) setCommitMessage('')
      await loadReview()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Git 操作失败')
    } finally {
      setBusyAction('')
    }
  }

  if (!workspaceId) {
    return <PanelEmpty title="未选择工作区" description="选择一个绑定本地目录的工作区后，即可审阅 Git 变更。" />
  }
  if (loading && !review) return <PanelLoading label="正在读取工作区变更…" />
  if (error && !review) return <PanelError message={error} action={<RetryButton onClick={() => void loadReview()} />} />
  if (!review) return null
  if (!review.repository) {
    return <PanelEmpty title="不是 Git 工作区" description="当前目录没有可用的 Git 仓库，审阅面板不会伪造变更。" />
  }

  const selectedFile = review.files.find((file) => file.path === selectedPath)
  const canPush = review.branch.hasRemote && !review.branch.detached
  const canCommit = Boolean(commitMessage.trim()) && !busyAction

  return (
    <div className="workspace-review">
      <div className="workspace-review-summary">
        <div className="workspace-review-branch" title={review.branch.upstream || review.branch.name}>
          <GitBranch size={13} aria-hidden="true" />
          <strong>{review.branch.name}</strong>
          {review.branch.upstream ? <span>↕ {review.branch.behind}/{review.branch.ahead}</span> : <span>未跟踪远程</span>}
        </div>
        <div className="workspace-review-stats" aria-label={`新增 ${review.stats.additions} 行，删除 ${review.stats.deletions} 行`}>
          <span className="is-added">+{review.stats.additions.toLocaleString()}</span>
          <span className="is-deleted">-{review.stats.deletions.toLocaleString()}</span>
        </div>
        <button
          type="button"
          className={`workspace-review-tool${commitOpen ? ' is-active' : ''}`}
          onClick={() => setCommitOpen((current) => !current)}
          aria-expanded={commitOpen}
          aria-label="打开提交面板"
          title="提交与推送"
        >
          <GitCommitHorizontal size={14} />
        </button>
        <button
          type="button"
          className="workspace-review-tool"
          onClick={() => void loadReview()}
          disabled={loading}
          aria-label="刷新工作区变更"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'tool-spinner' : undefined} />
        </button>
      </div>

      {error ? <div className="workspace-inline-error" role="alert">{error}</div> : null}
      {notice ? <div className="workspace-review-notice" role="status">{notice}</div> : null}

      {review.clean ? (
        <PanelEmpty title="没有待审阅变更" description="工作区与当前 Git 基线一致。" />
      ) : (
        <div className="workspace-review-body">
          {filesVisible ? (
            <div className="workspace-review-navigation">
              <div className="workspace-pane-heading">
                <span>变更文件</span>
                <small>{review.files.length}</small>
              </div>
              <div className="workspace-review-files" aria-label="变更文件">
                {review.files.map((file) => {
                  const active = file.path === selectedPath
                  const label = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path
                  return (
                    <button
                      type="button"
                      className={`workspace-review-file${active ? ' is-active' : ''}`}
                      key={`${file.indexStatus}${file.worktreeStatus}:${file.path}`}
                      onClick={() => setSelectedPath(file.path)}
                      aria-pressed={active}
                      title={label}
                    >
                      <span className={`workspace-review-kind is-${file.kind}`}>{KIND_LABELS[file.kind]}</span>
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="workspace-review-preview">
            <div className="workspace-review-diff-heading">
              <button
                type="button"
                className="workspace-review-tool"
                onClick={() => setFilesVisible((current) => !current)}
                aria-label={filesVisible ? '隐藏变更文件列表' : '显示变更文件列表'}
                title={filesVisible ? '隐藏文件列表' : '显示文件列表'}
              >
                {filesVisible ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <FileDiff size={13} aria-hidden="true" />
              <span title={selectedFile?.path}>{selectedFile?.path || '差异预览'}</span>
              {fileDiff?.truncated ? <small>已截断</small> : null}
              <div className="workspace-review-view-switch" aria-label="差异视图">
                <button
                  type="button"
                  className={diffMode === 'unified' ? 'is-active' : ''}
                  onClick={() => setDiffMode('unified')}
                  aria-pressed={diffMode === 'unified'}
                  title="统一差异"
                >
                  <AlignJustify size={13} />
                </button>
                <button
                  type="button"
                  className={diffMode === 'split' ? 'is-active' : ''}
                  onClick={() => setDiffMode('split')}
                  aria-pressed={diffMode === 'split'}
                  title="拆分差异"
                >
                  <Columns2 size={13} />
                </button>
              </div>
            </div>
            {fileLoading ? (
              <div className="file-preview-status">正在读取文件差异…</div>
            ) : fileDiff?.binary ? (
              <div className="workspace-review-note">二进制文件不支持行级差异预览。</div>
            ) : fileDiff ? (
              diffMode === 'split' ? (
                <ReadonlyDiffEditor
                  original={fileDiff.original}
                  modified={fileDiff.modified}
                  path={fileDiff.path}
                  ariaLabel={`${fileDiff.path} 拆分差异`}
                />
              ) : (
                <ReadonlyCodeEditor
                  value={fileDiff.unified}
                  path={fileDiff.path}
                  language="diff"
                  ariaLabel={`${fileDiff.path} 统一差异`}
                />
              )
            ) : (
              <div className="workspace-review-note">选择左侧文件查看差异。</div>
            )}
          </div>
        </div>
      )}

      {commitOpen ? (
        <div className="workspace-review-commit-panel">
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="提交信息"
            aria-label="提交信息"
            rows={2}
            maxLength={500}
          />
          <label className="workspace-review-stage-option">
            <input
              type="checkbox"
              checked={includeUnstaged}
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
            />
            <span>包含未暂存的更改</span>
          </label>
          <div className="workspace-review-actions">
            <button
              type="button"
              onClick={() => void runReviewAction('commit')}
              disabled={!canCommit}
            >
              <GitCommitHorizontal size={13} />
              <span>{busyAction === 'commit' ? '提交中…' : '提交'}</span>
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void runReviewAction('commit-push')}
              disabled={!canCommit || !canPush}
            >
              <UploadCloud size={13} />
              <span>{busyAction === 'commit-push' ? '提交并推送中…' : '提交并推送'}</span>
            </button>
            <button
              type="button"
              onClick={() => void runReviewAction('push')}
              disabled={Boolean(busyAction) || !canPush || review.branch.ahead === 0}
            >
              <UploadCloud size={13} />
              <span>{busyAction === 'push' ? '推送中…' : '推送'}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
