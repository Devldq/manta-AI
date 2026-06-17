/* WorkspaceList — 工作空间模式内容列表（支持二级展开） */
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConversationStore } from '@/stores/conversation-store'
import { SkeletonSidebarList } from '@/app/components/skeleton'

export function WorkspaceList() {
  const items = useWorkspaceStore((s) => s.items)
  const expandedIds = useWorkspaceStore((s) => s.expandedIds)
  const loading = useWorkspaceStore((s) => s.loading)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const conversationsByWs = useWorkspaceStore((s) => s.conversationsByWs)
  const loadingWsIds = useWorkspaceStore((s) => s.loadingWsIds)
  const fetchConversations = useWorkspaceStore((s) => s.fetchConversations)

  const router = useRouter()
  const setActiveId = useConversationStore((s) => s.setActiveId)

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 工作空间列表加载后，自动加载所有会话
  useEffect(() => {
    if (items.length > 0) {
      items.forEach((ws) => {
        fetchConversations(ws.id)
      })
    }
  }, [items, fetchConversations])

  // 展开/折叠时加载该工作空间的会话
  async function handleToggle(wsId: string) {
    const wasExpanded = expandedIds.has(wsId)
    toggleExpand(wsId)

    if (!wasExpanded) {
      // 首次展开，加载会话
      await fetchConversations(wsId)
    }
  }

  function formatTime(date?: string) {
    if (!date) return ''
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN })
        .replace('大约 ', '')
        .replace(' 前', '')
    } catch {
      return ''
    }
  }

  function handleConvClick(convId: string, wsId: string) {
    setActiveId(convId)
    router.push(`/tasks?workspaceId=${wsId}&convId=${convId}`)
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
        // 立即跳转，不等待列表刷新
        router.push(`/tasks?workspaceId=${wsId}&convId=${convId}`)
        // 后台刷新该工作空间的会话列表
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
        // 如果删除的是当前活跃会话，立即跳转
        const activeId = useConversationStore.getState().activeId
        if (activeId === convId) {
          router.push(`/tasks?workspaceId=${wsId}`)
        }
        // 后台刷新该工作空间的会话列表
        fetchConversations(wsId, true)
      }
    } catch {
      // 忽略错误
    }
  }

  // 移除骨架屏，直接显示内容或空状态
  // if (loading && items.length === 0) {
  //   return <SkeletonSidebarList itemCount={4} />
  // }

  if (items.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-text-muted">暂无工作空间</span>
      </div>
    )
  }

  return (
    <div className="py-1 space-y-0.5">
      {items.map((ws) => {
        const isExpanded = expandedIds.has(ws.id)
        const isLoading = loadingWsIds.has(ws.id)
        const conversations = conversationsByWs[ws.id]

        return (
          <div key={ws.id}>
            {/* 工作空间一级项 */}
            <div
              className="group flex items-center gap-2 px-3 py-1.5 mx-2 rounded cursor-pointer text-sidebar-text-secondary hover:bg-border/50 transition-colors"
              onClick={() => handleToggle(ws.id)}
            >
              <ChevronRight
                size={12}
                className={`text-text-muted flex-shrink-0 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
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
              <div className="ml-6 space-y-0.5 py-0.5">
                {isLoading ? (
                  <SkeletonSidebarList itemCount={3} />
                ) : !conversations || conversations.length === 0 ? (
                  <div className="px-3 py-2">
                    <span className="text-[10px] text-text-muted">暂无会话</span>
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="group relative flex items-center gap-2 px-3 py-1.5 mx-1 rounded cursor-pointer text-sidebar-text-secondary hover:bg-border/50 transition-colors"
                      onClick={() => handleConvClick(conv.id, ws.id)}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-text-muted opacity-40 flex-shrink-0" />
                      <span className="text-[11px] flex-1 truncate" title={conv.title}>
                        {conv.title}
                      </span>
                      <span className="text-[10px] text-text-muted w-10 text-right flex-shrink-0">
                        {formatTime(conv.updatedAt)}
                      </span>
                      <button
                        className="absolute right-2 hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-text-muted hover:text-status-failed transition-colors"
                        onClick={(e) => handleDeleteConversation(ws.id, conv.id, e)}
                        title="删除会话"
                      >
                        <span className="text-[11px]">×</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
