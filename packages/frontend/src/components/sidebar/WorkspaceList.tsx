/* WorkspaceList — 工作空间分组列表（支持二级展开） */

import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Plus, Folder, Square, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConversationStore } from '@/stores/conversation-store'
import { SkeletonSidebarList } from '@/components/skeleton'
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

  // URL 中有工作空间时，自动展开并加载该工作空间的对话
  useEffect(() => {
    if (urlWorkspaceId && items.length > 0) {
      if (!expandedIds.has(urlWorkspaceId)) {
        toggleExpand(urlWorkspaceId)
      }
      fetchConversations(urlWorkspaceId, true)
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
      <div className="pt-1 flex-1 flex flex-col overflow-hidden">
        {/* ── 工作空间分组头（吸顶） ── */}
        <div className="flex items-center justify-between pl-3 pr-1 py-1 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
            <span className="text-xs font-medium text-text-muted uppercase select-none">工作空间</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className="p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary mr-2"
              onClick={handleNewWorkspace}
              title="新建工作空间"
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
        {/* 列表区域（可滚动） */}
        <div className="flex-1 overflow-y-auto scrollbar-none">
          <div className="px-4 py-2">
            <span className="text-[11px] text-text-muted">暂无工作空间</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-1 flex-1 flex flex-col overflow-hidden">
      {/* ── 工作空间分组头（吸顶，可折叠） ── */}
      <div
        className="flex items-center justify-between pl-3 pr-1 py-1 cursor-pointer hover:bg-border/30 rounded transition-colors flex-shrink-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronRight
            size={12}
            className={`text-text-muted flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className={`text-xs font-medium uppercase select-none ${collapsed ? 'text-text-muted' : 'text-sidebar-text'}`}>工作空间</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary mr-2"
            onClick={(e) => { e.stopPropagation(); handleNewWorkspace() }}
            title="新建工作空间"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* ── 工作空间列表（可滚动） ── */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto scrollbar-none">
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
                  <span className="text-[10px] text-text-muted group-hover:hidden">
                    {conversations ? `${conversations.length}` : ws.conversationCount > 0 ? `${ws.conversationCount}` : ''}
                  </span>
                  {/* 新建会话按钮 */}
                  <button
                    className="hidden group-hover:flex items-center justify-center p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary"
                    onClick={(e) => handleNewConversation(ws.id, e)}
                    title="新建会话"
                  >
                    <Plus size={12} />
                  </button>
                  {/* 删除工作空间按钮 */}
                  <button
                    className="hidden group-hover:flex items-center justify-center p-0.5 rounded hover:bg-border text-text-muted hover:text-status-failed transition-colors"
                    onClick={(e) => { e.stopPropagation(); setDelWsId(ws.id) }}
                    title="删除工作空间"
                  >
                    <Trash2 size={12} />
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
                            className={`group relative flex items-center gap-2 px-3 py-1.5 mx-2 rounded cursor-pointer transition-colors ${
                              isActiveConv
                                ? 'bg-border text-sidebar-text'
                                : 'text-sidebar-text-secondary hover:bg-border/50'
                            }`}
                            onClick={() => handleConvClick(conv.id, ws.id)}
                          >
                            <Square size={15} className={`flex-shrink-0 ${isActiveConv ? 'text-accent' : 'text-text-muted'}`} />
                            <span
                              className={`text-xs flex-1 truncate ${isActiveConv ? 'font-medium' : ''}`}
                              title={conv.title}
                            >
                              {conv.title}
                            </span>
                            <span className="text-[10px] text-text-muted flex-shrink-0 group-hover:hidden">
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