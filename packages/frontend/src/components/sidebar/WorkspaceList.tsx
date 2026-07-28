/* WorkspaceList — 工作空间分组列表（支持二级展开） */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Plus, Folder, FolderOpen, Trash2 } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConversationStore } from '@/stores/conversation-store'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function WorkspaceList() {
  const items = useWorkspaceStore((s) => s.items)
  const expandedIds = useWorkspaceStore((s) => s.expandedIds)
  const loading = useWorkspaceStore((s) => s.loading)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWs)
  const loadingWsIds = useWorkspaceStore((s) => s.loadingWsIds)
  const fetchConversations = useWorkspaceStore((s) => s.fetchConversations)

  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace)

  const navigate = useNavigate()
  const location = useLocation()
  const activeId = useConversationStore((s) => s.activeId)
  const setActiveId = useConversationStore((s) => s.setActiveId)
  const [collapsed, setCollapsed] = useState(false)
  const [delWsId, setDelWsId] = useState<string | null>(null)

  // 从 URL 读取当前工作空间 ID
  const urlWorkspaceId = (() => {
    const params = new URLSearchParams(location.search)
    return params.get('workspaceid') || params.get('workspaceId')
  })()

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 默认展开的项目需要立即加载任务；store 会阻止缓存命中后的重复请求。
  useEffect(() => {
    for (const ws of items) {
      if (expandedIds.has(ws.id)) {
        void fetchConversations(ws.id)
      }
    }
  }, [expandedIds, fetchConversations, items])

  // URL 中有工作空间时，自动展开并加载该工作空间的对话
  useEffect(() => {
    if (urlWorkspaceId && items.length > 0) {
      if (!expandedIds.has(urlWorkspaceId)) {
        toggleExpand(urlWorkspaceId)
      }
      fetchConversations(urlWorkspaceId)
    }
  }, [urlWorkspaceId, items.length])

  // 展开/折叠时加载该工作空间的会话
  async function handleToggle(wsId: string) {
    const wasExpanded = expandedIds.has(wsId)
    toggleExpand(wsId)

    if (!wasExpanded) {
      await fetchConversations(wsId)
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
    // 乐观移除：先从会话列表中移除，避免 UI 闪烁
    const prev = conversationsByWs[wsId]
    if (prev) {
      useWorkspaceStore.setState((s) => ({
        conversationsByWs: { ...s.conversationsByWs, [wsId]: prev.filter((c) => c.id !== convId) },
      }))
    }
    // 如果正在查看该会话，先导航离开
    if (activeId === convId) {
      navigate(`/tasks?workspaceId=${wsId}`, { replace: true })
    }
    try {
      await fetch(`/api/conversations/${convId}?type=workspace&workspaceId=${wsId}`, {
        method: 'DELETE',
      })
    } catch {
      // 删除失败，回滚
      fetchConversations(wsId, true)
    }
  }

  async function handleDeleteWorkspace() {
    if (!delWsId) return
    const wsId = delWsId
    setDelWsId(null)
    // 先导航离开（如果正在查看该工作空间），避免页面闪烁
    if (urlWorkspaceId === wsId) {
      navigate('/tasks', { replace: true })
    }
    // store.deleteWorkspace 内部已做乐观移除，直接调用即可
    await deleteWorkspace(wsId)
  }

  function handleNewWorkspace() {
    navigate('/workspace/new')
  }

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="mx-2.5 mt-0.5 flex items-center justify-between py-0.5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <ChevronRight size={11} className="text-text-muted flex-shrink-0" />
            <span className="text-[12px] font-semibold text-sidebar-text-secondary select-none">项目</span>
          </div>
          <div className="flex items-center gap-1 opacity-70 hover:opacity-100">
            <button
              className="mr-0.5 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-border/50 hover:text-sidebar-text-secondary transition-colors"
              onClick={handleNewWorkspace}
              title="新建工作空间"
            >
              <Plus size={11} />
            </button>
          </div>
        </div>
        <div className="sidebar-scrollbar flex-1 overflow-y-auto">
          <div className="px-3 py-1">
            <span className="text-[12px] text-text-muted">暂无项目</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div
        className="mx-2.5 mt-0.5 flex items-center justify-between py-0.5 cursor-pointer transition-colors flex-shrink-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronRight
            size={11}
            className={`text-text-muted flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className={`text-[12px] font-semibold select-none ${collapsed ? 'text-text-muted' : 'text-sidebar-text-secondary'}`}>项目</span>
          {!collapsed && items.length > 0 && (
            <span className="text-[11px] text-text-muted leading-none">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-70 hover:opacity-100">
          <button
            className="mr-0.5 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-border/50 hover:text-sidebar-text-secondary transition-colors"
            onClick={(e) => { e.stopPropagation(); handleNewWorkspace() }}
            title="新建工作空间"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="sidebar-scrollbar flex-1 overflow-y-auto px-2 pb-0.5">
          {items.map((ws) => {
            const isExpanded = expandedIds.has(ws.id)
            const isLoading = loadingWsIds.has(ws.id)
            const conversations = conversationsByWs[ws.id]

            return (
              <div key={ws.id} className="mb-0.5">
                <div className="group flex items-center gap-1.5 py-0.5 pl-3 pr-0.5 text-sidebar-text-secondary">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => void handleToggle(ws.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`workspace-tasks-${ws.id}`}
                  >
                    <ChevronRight
                      size={11}
                      className={`text-text-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    {isExpanded ? (
                      <FolderOpen size={16} className="text-sidebar-text-secondary flex-shrink-0" strokeWidth={1.8} />
                    ) : (
                      <Folder size={16} className="text-sidebar-text-secondary flex-shrink-0" strokeWidth={1.8} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight text-sidebar-text">
                      {ws.name}
                    </span>
                  </button>
                  <div className="flex w-[54px] flex-shrink-0 items-center justify-end gap-1">
                    <span className="text-[10px] text-text-muted transition-opacity group-hover:opacity-0">
                      {conversations ? `${conversations.length}` : ws.conversationCount > 0 ? `${ws.conversationCount}` : ''}
                    </span>
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 pointer-events-none hover:bg-border/50 hover:text-sidebar-text-secondary transition-colors group-hover:opacity-100 group-hover:pointer-events-auto"
                      onClick={(e) => handleNewConversation(ws.id, e)}
                      title="新建会话"
                    >
                      <Plus size={11} />
                    </button>
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 pointer-events-none hover:bg-status-failed/10 hover:text-status-failed transition-colors group-hover:opacity-100 group-hover:pointer-events-auto"
                      onClick={(e) => { e.stopPropagation(); setDelWsId(ws.id) }}
                      title="删除工作空间"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div id={`workspace-tasks-${ws.id}`} className="ml-8 mt-0.5">
                    {isLoading ? (
                      <div className="px-1.5 py-1">
                        <span className="text-[12px] text-text-muted">加载中...</span>
                      </div>
                    ) : !conversations || conversations.length === 0 ? (
                      <div className="px-1.5 py-1">
                        <span className="text-[12px] text-text-muted">无任务</span>
                      </div>
                    ) : (
                      conversations.map((conv) => {
                        const isActiveConv = activeId === conv.id
                        return (
                          <div
                            key={conv.id}
                            className={`group relative mb-px flex items-center gap-1.5 rounded-md px-2 py-0.5 cursor-pointer transition-colors ${
                              isActiveConv
                                ? 'bg-border/45 text-sidebar-text'
                                : 'text-sidebar-text-secondary hover:bg-border/20'
                            }`}
                            onClick={() => handleConvClick(conv.id, ws.id)}
                          >
                            <div className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[12px] leading-snug ${isActiveConv ? 'font-semibold text-sidebar-text' : 'font-medium'}`}
                                title={conv.title}
                              >
                                {conv.title}
                              </span>
                            </div>
                            <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                              <button
                                className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 pointer-events-none hover:bg-status-failed/10 hover:text-status-failed transition-colors group-hover:opacity-100 group-hover:pointer-events-auto"
                                onClick={(e) => handleDeleteConversation(ws.id, conv.id, e)}
                                title="删除"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
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
      )}

      {/* 删除工作空间确认弹窗 */}
      <ConfirmDialog
        open={!!delWsId}
        title="删除工作空间"
        message={`确定要删除该工作空间吗？工作空间下的所有任务也将被一并删除，此操作不可撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={handleDeleteWorkspace}
        onCancel={() => setDelWsId(null)}
      />
    </div>
  )
}
