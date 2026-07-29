import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { AlertCircle, ChevronRight, File, Folder, FolderOpen, Image, Loader2 } from 'lucide-react'
import type { SessionSidebarContext } from './tabs'
import { PanelEmpty, PanelError, PanelLoading, RetryButton } from './PanelState'
import { ReadonlyCodeEditor } from './ReadonlyCodeEditor'

interface FileEntry {
  name: string
  path: string
  kind: 'directory' | 'file'
}

interface FilePreview {
  kind: 'text' | 'image'
  path: string
  size: number
  content: string
  mimeType?: string
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function FilesTab({ workspaceId, previewPath }: SessionSidebarContext) {
  const [directories, setDirectories] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [treeError, setTreeError] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(previewPath)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  const loadDirectory = useCallback(async (path: string) => {
    if (!workspaceId) return
    setLoadingPaths((current) => new Set(current).add(path))
    setTreeError('')
    try {
      const query = new URLSearchParams({ workspaceId, ...(path ? { path } : {}) })
      const response = await fetch(`/api/fs/tree?${query}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '无法读取目录')
      setDirectories((current) => ({ ...current, [path]: data.entries }))
    } catch (reason) {
      setTreeError(reason instanceof Error ? reason.message : '无法读取目录')
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }, [workspaceId])

  useEffect(() => {
    setDirectories({})
    setExpanded(new Set())
    if (workspaceId) void loadDirectory('')
  }, [loadDirectory, workspaceId])

  useEffect(() => {
    if (previewPath) setSelectedPath(previewPath)
  }, [previewPath])

  useEffect(() => {
    if (!workspaceId || !selectedPath) {
      setPreview(null)
      setPreviewError('')
      return
    }
    const controller = new AbortController()
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    const query = new URLSearchParams({ workspaceId, path: selectedPath })
    fetch(`/api/fs/preview?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || '无法读取文件')
        return data as FilePreview
      })
      .then(setPreview)
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setPreviewError(reason instanceof Error ? reason.message : '无法读取文件')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false)
      })
    return () => controller.abort()
  }, [selectedPath, workspaceId])

  async function toggleDirectory(path: string) {
    if (expanded.has(path)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
      return
    }
    setExpanded((current) => new Set(current).add(path))
    if (!directories[path]) await loadDirectory(path)
  }

  if (!workspaceId) {
    return <PanelEmpty title="未选择工作区" description="选择一个绑定本地目录的工作区后，即可浏览和预览文件。" />
  }
  if (loadingPaths.has('') && !directories['']) return <PanelLoading label="正在读取文件目录…" />
  if (treeError && !directories['']) return <PanelError message={treeError} action={<RetryButton onClick={() => void loadDirectory('')} />} />

  const rootEntries = directories[''] ?? []
  return (
    <div className="workspace-files">
      <div className="workspace-file-tree" role="tree" aria-label="工作区文件">
        {treeError ? (
          <div className="workspace-inline-error" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            <span>{treeError}</span>
          </div>
        ) : null}
        {rootEntries.length ? rootEntries.map((entry) => (
          <FileTreeEntry
            key={entry.path}
            entry={entry}
            depth={0}
            directories={directories}
            expanded={expanded}
            loadingPaths={loadingPaths}
            selectedPath={selectedPath}
            onToggle={toggleDirectory}
            onSelect={setSelectedPath}
          />
        )) : <div className="workspace-review-note">工作区目录为空。</div>}
      </div>
      <div className="workspace-file-preview" aria-live="polite">
        {!selectedPath ? (
          <div className="workspace-file-preview-empty">
            <File size={18} aria-hidden="true" />
            <span>选择文件以预览</span>
          </div>
        ) : (
          <>
            <div className="file-preview-meta">
              <span title={preview?.path || selectedPath}>{preview?.path || selectedPath}</span>
              {preview ? <small>只读 · {formatBytes(preview.size)}</small> : null}
            </div>
            {previewLoading ? <div className="file-preview-status"><Loader2 size={15} className="tool-spinner" />正在读取文件…</div> : null}
            {previewError ? <div className="file-preview-status is-error"><AlertCircle size={15} />{previewError}</div> : null}
            {preview?.kind === 'image' ? (
              <div className="file-preview-image-wrap">
                <img src={`data:${preview.mimeType};base64,${preview.content}`} alt={preview.path} />
              </div>
            ) : null}
            {preview?.kind === 'text' ? (
              <ReadonlyCodeEditor
                value={preview.content}
                path={preview.path}
                ariaLabel={`${preview.path} 只读代码预览`}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function FileTreeEntry({
  entry,
  depth,
  directories,
  expanded,
  loadingPaths,
  selectedPath,
  onToggle,
  onSelect,
}: {
  entry: FileEntry
  depth: number
  directories: Record<string, FileEntry[]>
  expanded: Set<string>
  loadingPaths: Set<string>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}) {
  const isDirectory = entry.kind === 'directory'
  const isExpanded = expanded.has(entry.path)
  const isLoading = loadingPaths.has(entry.path)
  const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : fileIcon(entry.path)
  return (
    <>
      <button
        type="button"
        className="workspace-file-row"
        style={{ '--file-depth': depth } as CSSProperties}
        role="treeitem"
        aria-selected={!isDirectory && selectedPath === entry.path}
        aria-expanded={isDirectory ? isExpanded : undefined}
        onClick={() => isDirectory ? void onToggle(entry.path) : onSelect(entry.path)}
      >
        {isDirectory ? <ChevronRight size={12} className={isExpanded ? 'is-expanded' : undefined} aria-hidden="true" /> : <span className="workspace-file-spacer" />}
        {isLoading ? <Loader2 size={13} className="tool-spinner" aria-hidden="true" /> : <Icon size={13} aria-hidden="true" />}
        <span title={entry.path}>{entry.name}</span>
      </button>
      {isDirectory && isExpanded ? (directories[entry.path] ?? []).map((child) => (
        <FileTreeEntry
          key={child.path}
          entry={child}
          depth={depth + 1}
          directories={directories}
          expanded={expanded}
          loadingPaths={loadingPaths}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      )) : null}
    </>
  )
}

function fileIcon(path: string) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(path) ? Image : File
}
