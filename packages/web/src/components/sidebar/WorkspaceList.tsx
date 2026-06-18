/* 工作空间列表组件 */
import { useState, useEffect } from 'react'
import { FolderOpen, ChevronRight, ChevronDown, MessageSquare, Plus } from 'lucide-react'

interface Workspace {
  id: string
  name: string
  description?: string
}

interface WorkspaceListProps {
  searchQuery?: string
}

export function WorkspaceList({ searchQuery = '' }: WorkspaceListProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    // 从 API 获取工作空间列表
    fetch('/api/workspaces')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setWorkspaces(data.data.workspaces)
          // 默认展开所有工作空间
          setExpandedIds(new Set(data.data.workspaces.map((w: Workspace) => w.id)))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filteredWorkspaces = workspaces.filter(ws =>
    ws.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-10 bg-surface-elevated rounded-md animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1">
      {filteredWorkspaces.map((workspace) => (
        <div key={workspace.id}>
          <div
            onClick={() => {
              toggleExpand(workspace.id)
              setActiveId(workspace.id)
            }}
            className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${
              activeId === workspace.id
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-elevated'
            }`}
          >
            {expandedIds.has(workspace.id) ? (
              <ChevronDown size={14} className="flex-shrink-0" />
            ) : (
              <ChevronRight size={14} className="flex-shrink-0" />
            )}
            <FolderOpen size={16} className="flex-shrink-0" />
            <span className="text-sm flex-1 truncate">{workspace.name}</span>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface rounded"
              title="Add conversation"
              onClick={(e) => {
                e.stopPropagation()
                // TODO: 创建新会话
              }}
            >
              <Plus size={12} />
            </button>
          </div>

          {expandedIds.has(workspace.id) && (
            <div className="ml-6 pl-2 border-l border-border-subtle">
              <WorkspaceConversationList workspaceId={workspace.id} />
            </div>
          )}
        </div>
      ))}

      {filteredWorkspaces.length === 0 && (
        <div className="px-3 py-4 text-center text-text-muted text-sm">
          {searchQuery ? 'No workspaces found' : 'No workspaces yet'}
        </div>
      )}
    </div>
  )
}

function WorkspaceConversationList({ workspaceId }: { workspaceId: string }) {
  const [conversations, setConversations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/conversations?type=workspace&workspaceId=${workspaceId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setConversations(data.data.conversations)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [workspaceId])

  if (loading) {
    return (
      <div className="py-1 space-y-1">
        {[1, 2].map(i => (
          <div key={i} className="h-8 bg-surface-elevated rounded animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="py-1 space-y-1">
      {conversations.map((conv: any) => (
        <div
          key={conv.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded text-text-secondary hover:bg-surface-elevated cursor-pointer"
        >
          <MessageSquare size={14} />
          <span className="text-xs truncate">{conv.title}</span>
        </div>
      ))}

      {conversations.length === 0 && (
        <div className="px-2 py-2 text-xs text-text-muted">
          No conversations
        </div>
      )}
    </div>
  )
}
