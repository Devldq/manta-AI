/* SkillFileBrowser — 大型 Skill 文件树浏览 + 在线编辑
 *
 * 布局：左侧文件树 + 右侧内容区（只读/编辑双模式）
 * 美学方向：冷色工具风，VS Code 精神但更有温度
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  FolderOpen,
  Folder,
  ArrowLeft,
  Edit3,
  Eye,
  Save,
  X,
  Loader2,
  FileCode,
  FileJson,
  File,
} from 'lucide-react'

// ─── 类型 ─────────────────────────────────────────────────────

interface SkillFileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  extension?: string
  children?: SkillFileEntry[]
}

interface FileTab {
  path: string
  name: string
  content: string
  isDirty: boolean
  loading: boolean
}

// ─── 工具 ─────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(extension?: string) {
  switch (extension) {
    case 'md': return <FileText size={14} style={{ color: 'var(--color-accent)' }} />
    case 'json': return <FileJson size={14} style={{ color: '#eab308' }} />
    case 'js':
    case 'mjs':
    case 'ts':
    case 'tsx':
    case 'jsx': return <FileCode size={14} style={{ color: '#60a5fa' }} />
    default: return <File size={14} style={{ color: 'var(--color-text-muted)' }} />
  }
}

// ─── API ──────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || '请求失败')
  return data
}

// ─── 组件入口 ─────────────────────────────────────────────────

interface Props {
  skillName: string
  onBack: () => void
}

export default function SkillFileBrowser({ skillName, onBack }: Props) {
  const [tree, setTree] = useState<SkillFileEntry[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState('')

  // 已打开的文件 tabs
  const [tabs, setTabs] = useState<FileTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  // 文件内容编辑
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  // 文件树展开状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // ── 查找第一个文件 ─────────────────────────────────────────

  function findFirstFile(entries: SkillFileEntry[]): SkillFileEntry | null {
    // 优先 SKILL.md，其次第一个普通文件，再次递归进入第一个目录
    const skillMd = entries.find((e) => e.type === 'file' && e.name === 'SKILL.md')
    if (skillMd) return skillMd

    for (const entry of entries) {
      if (entry.type === 'file') return entry
    }
    for (const entry of entries) {
      if (entry.type === 'directory' && entry.children?.length) {
        const found = findFirstFile(entry.children)
        if (found) return found
      }
    }
    return null
  }

  // ── 加载文件树 ─────────────────────────────────────────────

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    setTreeError('')
    try {
      const data = await apiFetch<{ data: { tree: SkillFileEntry[] } }>(`/api/skills/${skillName}/files`)
      const t = data.data?.tree || []
      setTree(t)
      // 默认展开第一层目录
      const firstLevel = new Set<string>()
      t.forEach((e) => { if (e.type === 'directory') firstLevel.add(e.path) })
      setExpandedDirs(firstLevel)
      // 自动打开第一个文件
      const first = findFirstFile(t)
      if (first) {
        // 递归展开到该文件的父目录路径
        const parts = first.path.split('/')
        parts.pop() // 去掉文件名
        let dir = ''
        for (const p of parts) {
          dir = dir ? `${dir}/${p}` : p
          firstLevel.add(dir)
        }
        // 触发文件打开（通过设置初始活动路径，在下个 effect 处理）
        setPendingAutoOpen(first)
      }
    } catch (e: any) {
      setTreeError(e.message)
    } finally {
      setTreeLoading(false)
    }
  }, [skillName])

  useEffect(() => { loadTree() }, [loadTree])

  // 自动打开第一个文件
  const [pendingAutoOpen, setPendingAutoOpen] = useState<SkillFileEntry | null>(null)

  // ── 打开文件 ───────────────────────────────────────────────

  const openFile = useCallback(async (entry: SkillFileEntry) => {
    if (entry.type === 'directory') return

    const existing = tabs.find((t) => t.path === entry.path)
    if (existing) {
      setActivePath(existing.path)
      setEditingPath(null)
      return
    }

    const newTab: FileTab = {
      path: entry.path,
      name: entry.name,
      content: '',
      isDirty: false,
      loading: true,
    }
    setTabs((prev) => [...prev, newTab])
    setActivePath(entry.path)
    setEditingPath(null)

    try {
      const data = await apiFetch<{ data: { content: string } }>(
        `/api/skills/${skillName}/files/content?path=${encodeURIComponent(entry.path)}`,
      )
      setTabs((prev) =>
        prev.map((t) =>
          t.path === entry.path
            ? { ...t, content: data.data?.content || '', loading: false }
            : t,
        ),
      )
    } catch (e: any) {
      setTabs((prev) =>
        prev.map((t) =>
          t.path === entry.path
            ? { ...t, content: `// 读取失败: ${e.message}`, loading: false }
            : t,
        ),
      )
    }
  }, [tabs, skillName])

  // 树加载完成后自动打开第一个文件
  useEffect(() => {
    if (pendingAutoOpen && tree && !treeLoading) {
      openFile(pendingAutoOpen)
      setPendingAutoOpen(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoOpen, tree, treeLoading])

  // ── Tab 操作 ───────────────────────────────────────────────

  const closeTab = useCallback((tabPath: string) => {
    setTabs((prev) => prev.filter((t) => t.path !== tabPath))
    if (activePath === tabPath) {
      setTabs((prev) => {
        const idx = prev.indexOf(prev.find((t) => t.path === tabPath)!)
        const remaining = prev.filter((t) => t.path !== tabPath)
        if (remaining.length === 0) {
          setActivePath(null)
          return remaining
        }
        setActivePath(remaining[Math.min(idx, remaining.length - 1)]?.path || null)
        return remaining
      })
    }
    if (editingPath === tabPath) setEditingPath(null)
  }, [activePath, editingPath])

  // ── 编辑与保存 ────────────────────────────────────────────

  const startEdit = useCallback(() => {
    if (!activePath) return
    const tab = tabs.find((t) => t.path === activePath)
    if (tab) {
      setEditContent(tab.content)
      setEditingPath(activePath)
    }
  }, [activePath, tabs])

  const cancelEdit = useCallback(() => {
    setEditingPath(null)
    setEditContent('')
  }, [])

  const saveFile = useCallback(async () => {
    if (!editingPath) return
    setSaving(true)
    try {
      await apiFetch(`/api/skills/${skillName}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editingPath, content: editContent }),
      })
      setTabs((prev) =>
        prev.map((t) =>
          t.path === editingPath ? { ...t, content: editContent, isDirty: false } : t,
        ),
      )
      setEditingPath(null)
    } catch (e: any) {
      alert('保存失败: ' + e.message)
    } finally {
      setSaving(false)
    }
  }, [editingPath, editContent, skillName])

  const onEditChange = useCallback((value: string) => {
    setEditContent(value)
  }, [])

  // ── 目录展开/收起 ──────────────────────────────────────────

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  // ── breadcrumb ─────────────────────────────────────────────

  const breadcrumb = useMemo(() => {
    if (!activePath) return null
    const parts = activePath.split('/')
    return parts.map((p, i) => ({
      label: p,
      full: parts.slice(0, i + 1).join('/'),
      last: i === parts.length - 1,
    }))
  }, [activePath])

  const activeTab = useMemo(() => tabs.find((t) => t.path === activePath), [tabs, activePath])
  const isEditing = editingPath === activePath

  // ── 文件树宽度拖拽 ─────────────────────────────────────────
  const [treeWidth, setTreeWidth] = useState(240)
  const [dragging, setDragging] = useState(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = treeWidth
    setDragging(true)

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      setTreeWidth(Math.max(160, Math.min(420, startWidth + delta)))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [treeWidth])

  // ── 渲染 ───────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]" style={{ background: 'var(--color-background)' }}>
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors"
          style={{
            color: 'var(--color-text-muted)',
            background: 'transparent',
          }}
        >
          <ArrowLeft size={14} />
          返回列表
        </button>
        <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
          {skillName}
        </span>
        <span className="flex-1" />
        {breadcrumb && (
          <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {breadcrumb.map((crumb) => (
              <span key={crumb.full} className="flex items-center gap-1">
                {crumb.last ? (
                  <span style={{ color: 'var(--color-text-primary)' }}>{crumb.label}</span>
                ) : (
                  <>
                    <span>{crumb.label}</span>
                    <ChevronRight size={10} />
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Tabs bar */}
      {tabs.length > 0 && (
        <div
          className="flex items-center gap-0.5 px-2 py-1 flex-shrink-0 overflow-x-auto"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.path}
              onClick={() => { setActivePath(tab.path); setEditingPath(null) }}
              className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-t-md transition-colors whitespace-nowrap"
              style={{
                background: tab.path === activePath ? 'var(--color-background)' : 'transparent',
                color: tab.path === activePath ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                borderBottom: tab.path === activePath ? '2px solid var(--color-accent)' : '2px solid transparent',
              }}
            >
              {tab.loading
                ? <Loader2 size={10} className="animate-spin" />
                : fileIcon(tab.extension || undefined)}
              <span>{tab.name}</span>
              {tab.isDirty && <span style={{ color: '#eab308' }}>●</span>}
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.path) }}
                className="opacity-0 group-hover:opacity-100 ml-0.5 transition-opacity"
              >
                <X size={10} />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main: File Tree + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Tree */}
        <div
          className="flex-shrink-0 border-r overflow-y-auto"
          style={{
            width: treeWidth,
            borderColor: 'var(--color-border)',
            background: 'var(--color-surface)',
          }}
        >
          {treeLoading ? (
            <div className="flex items-center gap-2 px-3 py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              <Loader2 size={14} className="animate-spin" /> 加载文件树...
            </div>
          ) : treeError ? (
            <div className="px-3 py-4 text-xs" style={{ color: '#ef4444' }}>{treeError}</div>
          ) : tree ? (
            <div className="py-2">
              {tree.map((entry) => (
                <FileTreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  expandedDirs={expandedDirs}
                  activePath={activePath}
                  editingPath={editingPath}
                  onToggleDir={toggleDir}
                  onOpenFile={openFile}
                />
              ))}
              {tree.length === 0 && (
                <p className="px-3 py-8 text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
                  此 Skill 目录为空
                </p>
              )}
            </div>
          ) : null}
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          className="flex-shrink-0 w-1 cursor-col-resize transition-colors"
          style={{
            background: dragging ? 'var(--color-accent)' : 'transparent',
          }}
          onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = 'var(--color-border)' }}
          onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent' }}
        />

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {activeTab ? (
            <>
              {/* Toolbar */}
              <div
                className="flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                {!isEditing ? (
                  <button
                    onClick={startEdit}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors"
                    style={{
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <Edit3 size={12} /> 编辑
                  </button>
                ) : (
                  <>
                    <button
                      onClick={saveFile}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors disabled:opacity-50"
                      style={{ background: 'var(--color-accent)', color: '#fff' }}
                    >
                      {saving ? <><Loader2 size={12} className="animate-spin" /> 保存中...</> : <><Save size={12} /> 保存</>}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md transition-colors"
                      style={{ color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
                    >
                      <X size={12} /> 取消
                    </button>
                  </>
                )}
                <span className="flex-1" />
                {activeTab.size && (
                  <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    {formatSize(activeTab.size)}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <Eye size={10} className="inline" /> {isEditing ? '编辑中' : '只读'}
                </span>
              </div>

              {/* Content viewer/editor */}
              <div className="flex-1 overflow-auto">
                {activeTab.loading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-muted)' }} />
                  </div>
                ) : isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => onEditChange(e.target.value)}
                    className="w-full h-full resize-none p-4 font-mono text-xs leading-relaxed border-none"
                    style={{
                      background: 'var(--color-background)',
                      color: 'var(--color-text-primary)',
                      outline: 'none',
                      tabSize: 2,
                    }}
                    spellCheck={false}
                  />
                ) : (
                  <pre
                    className="p-4 m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
                    style={{
                      background: 'var(--color-background)',
                      color: 'var(--color-text-secondary)',
                      minHeight: '100%',
                    }}
                  >
                    {activeTab.content || '（空文件）'}
                  </pre>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FileText size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>从左侧文件树选择文件以查看内容</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  支持 Markdown、JavaScript、JSON 等格式
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 文件树节点 ──────────────────────────────────────────────────

function FileTreeNode({
  entry,
  depth,
  expandedDirs,
  activePath,
  editingPath,
  onToggleDir,
  onOpenFile,
}: {
  entry: SkillFileEntry
  depth: number
  expandedDirs: Set<string>
  activePath: string | null
  editingPath: string | null
  onToggleDir: (path: string) => void
  onOpenFile: (entry: SkillFileEntry) => void
}) {
  const isDir = entry.type === 'directory'
  const isExpanded = expandedDirs.has(entry.path)
  const isActive = activePath === entry.path
  const isEditing = editingPath === entry.path
  const indent = depth * 16 + 8

  return (
    <>
      <button
        onClick={() => isDir ? onToggleDir(entry.path) : onOpenFile(entry)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[12px] transition-colors"
        style={{
          paddingLeft: indent,
          color: isActive
            ? 'var(--color-text-primary)'
            : isDir
              ? 'var(--color-text-secondary)'
              : 'var(--color-text-muted)',
          background: isActive ? 'rgba(99,102,241,0.08)' : isEditing ? 'rgba(234,179,8,0.06)' : 'transparent',
          borderLeft: isActive ? '2px solid var(--color-accent)' : isEditing ? '2px solid #eab308' : '2px solid transparent',
        }}
      >
        {/* 目录展开/收起指示 */}
        {isDir ? (
          <span className="flex-shrink-0">
            {isExpanded
              ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)' }} />
              : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />}
          </span>
        ) : (
          <span className="flex-shrink-0 w-3" />
        )}

        {/* 图标 */}
        <span className="flex-shrink-0">
          {isDir
            ? isExpanded
              ? <FolderOpen size={14} style={{ color: '#eab308' }} />
              : <Folder size={14} style={{ color: '#eab308' }} />
            : fileIcon(entry.extension)}
        </span>

        {/* 文件名 */}
        <span className="truncate">{entry.name}</span>

        {/* 文件大小 */}
        {entry.type === 'file' && entry.size !== undefined && (
          <span className="flex-shrink-0 text-[10px] ml-auto opacity-50">{formatSize(entry.size)}</span>
        )}
      </button>

      {/* 递归渲染子节点 */}
      {isDir && isExpanded && entry.children && (
        <>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              activePath={activePath}
              editingPath={editingPath}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
            />
          ))}
        </>
      )}
    </>
  )
}
