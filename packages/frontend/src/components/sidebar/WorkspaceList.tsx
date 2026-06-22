/* WorkspaceList — 工作空间分组列表（支持二级展开） */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Folder, Square } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConversationStore } from '@/stores/conversation-store'
import { SkeletonSidebarList } from '@/components/skeleton'

export function WorkspaceList() {
  const items = useWorkspaceStore((s) => s.items)
  const expandedIds = useWorkspaceStore((s) => s.expandedIds)
  const loading = useWorkspaceStore((s) => s.loading)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWs)
  const loadingWsIds = useWorkspaceStore((s) => s.loadingWsIds)
  const fetchConversations = useWorkspaceStore((s) => s.fetchConversations)

  const navigate = useNavigate()
  const activeId = useConversationStore((s) => s.activeId)
  const setActiveId = useConversationStore((s) => s.setActiveId)

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 展开/折叠时加载该工作空间的会话
  async function handleToggle(wsId: string) {
    const wasExpanded = expandedIds.has(wsId)
    toggleExpand(wsId)

    if (!wasExpanded) {
      await fetchConversations(wsId)
    }
  }

  function formatTime(date?: string) {
    if (!date) return ''
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN })
        .replace('大约 ', '')
        .replace(' 前', '天前')
    } catch {
      return ''
    }
  }

  function handleConvClick(convId: string, wsId: string) {
    setActiveId(convId)
    navigate(`/tasks?workspaceId=${wsId}&convId=${convId}`)
  }

  async function handleNewConversation(wsId: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'default',
          title: '新对话',
          type: 'workspace',
          workspaceId: wsId,
        }),
      })
      const json = await res.json()
      if (json.success && json.data?.conversation) {
        const convId = json.data.conversation.id
        setActiveId(convId)
        navigate(`/tasks?workspaceId=${wsId}&convId=${convId}`)
        fetchConversations(wsId, true)
      }
    } catch {
      // 忽略错误
    }
  }

  async function handleDeleteConversation(wsId: string, convId: string, e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const res = await fetch(`/api/conversations/${convId}?type=workspace&workspaceId=${wsId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        if (activeId === convId) {
          navigate(`/tasks?workspaceId=${wsId}`)
        }
        fetchConversations(wsId, true)
      }
    } catch {
      // 忽略错误
    }
  }

  function handleNewWorkspace() {
    navigate('/workspace/new')
  }

  if (items.length === 0) {
    return (
      <div className="pt-1 flex-1 overflow-y-auto scrollbar-none">
        {/* ── 工作空间分组头 ── */}
        <div className="flex items-center justify-between pl-3 pr-1 py-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted select-none">▼</span>
            <span className="text-xs font-medium text-text-muted uppercase select-none">工作空间</span>
          </div>
          <button
            className="p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary mr-2"
            onClick={handleNewWorkspace}
            title="新建工作空间"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="px-4 py-2">
          <span className="text-[11px] text-text-muted">暂无工作空间</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-1 flex-1 overflow-y-auto scrollbar-none">
      {/* ── 工作空间分组头 ── */}
      <div className="flex items-center justify-between pl-3 pr-1 py-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-muted select-none">▼</span>
          <span className="text-xs font-medium text-text-muted uppercase select-none">工作空间</span>
        </div>
        <button
          className="p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary mr-2"
          onClick={handleNewWorkspace}
          title="新建工作空间"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="space-y-0.5">
        {items.map((ws) => {
          const isExpanded = expandedIds.has(ws.id)
          const isLoading = loadingWsIds.has(ws.id)
          const conversations = conversationsByWs[ws.id]

          return (
            <div key={ws.id}>
              {/* 工作空间一级项 */}
              <div
                className="group flex items-center gap-2 pl-3 pr-2 py-1.5 rounded cursor-pointer text-sidebar-text-secondary hover:bg-border/50 transition-colors"
                onClick={() => handleToggle(ws.id)}
              >
                <ChevronRight
                  size={12}
                  className={`text-text-muted flex-shrink-0 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
                <Folder size={14} className="text-text-muted flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{ws.name}</span>
                <span className="text-[10px] text-text-muted">
                  {conversations ? `${conversations.length}` : ws.conversationCount > 0 ? `${ws.conversationCount}` : ''}
                </span>
                {/* 新建会话按钮 */}
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary"
                  onClick={(e) => handleNewConversation(ws.id, e)}
                  title="新建会话"
                >
                  <Plus size={12} />
                </button>
              </div>

              {/* 二级会话列表（展开时） */}
              {isExpanded && (
                <div className="ml-4 py-0.5 border-l border-border-subtle">
                  {isLoading ? (
                    <div className="ml-2">
                      <SkeletonSidebarList itemCount={3} />
                    </div>
                  ) : !conversations || conversations.length === 0 ? (
                    <div className="px-3 py-2">
                      <span className="text-[11px] text-text-muted">暂无任务</span>
                    </div>
                  ) : (
                    conversations.map((conv) => {
                      const isActiveConv = activeId === conv.id
                      return (
                        <div
                          key={conv.id}
                          className={`group relative flex items-center gap-2 px-3 py-1.5 mx-1 rounded cursor-pointer transition-colors ${
                            isActiveConv
                              ? 'bg-border text-sidebar-text'
                              : 'text-sidebar-text-secondary hover:bg-border/50'
                          }`}
                          onClick={() => handleConvClick(conv.id, ws.id)}
                        >
                          <Square size={15} className={`flex-shrink-0 ${isActiveConv ? 'text-accent' : 'text-text-muted'}`} />
                          <span className="text-xs flex-1 truncate" title={conv.title}>
                            {conv.title}
                          </span>
                          <span className="text-[10px] text-text-muted flex-shrink-0">
                            {formatTime(conv.updatedAt)}
                          </span>
                          <button
                            className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded flex-shrink-0 text-text-muted hover:text-status-failed transition-colors"
                            onClick={(e) => handleDeleteConversation(ws.id, conv.id, e)}
                            title="删除"
                          >
                            <span className="text-[11px]">×</span>
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}