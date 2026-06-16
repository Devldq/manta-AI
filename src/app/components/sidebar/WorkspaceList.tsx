/* WorkspaceList — 工作空间模式内容列表（支持二级展开） */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useConversationStore, type ConversationSummary } from '@/stores/conversation-store'

export function WorkspaceList() {
  const items = useWorkspaceStore((s) => s.items)
  const expandedIds = useWorkspaceStore((s) => s.expandedIds)
  const loading = useWorkspaceStore((s) => s.loading)
  const fetchList = useWorkspaceStore((s) => s.fetchList)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)

  // 缓存每个工作空间的会话列表
  const [wsConversations, setWsConversations] = useState<Record<string, ConversationSummary[]>>({})
  const [loadingWs, setLoadingWs] = useState<Set<string>>(new Set())

  const router = useRouter()
  const setActiveId = useConversationStore((s) => s.setActiveId)

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 工作空间列表加载后，自动加载所有会话
  useEffect(() => {
    if (items.length > 0) {
      items.forEach((ws) => {
        if (!wsConversations[ws.id] && !loadingWs.has(ws.id)) {
          loadConversations(ws.id)
        }
      })
    }
  }, [items])

  async function loadConversations(wsId: string) {
    setLoadingWs((prev) => new Set(prev).add(wsId))
    try {
      const res = await fetch(`/api/conversations?type=workspace&workspaceId=${wsId}`)
      if (res.ok) {
        const data = await res.json()
        setWsConversations((prev) => ({ ...prev, [wsId]: data.data?.conversations ?? [] }))
      }
    } catch {
      setWsConversations((prev) => ({ ...prev, [wsId]: [] }))
    } finally {
      setLoadingWs((prev) => {
        const next = new Set(prev)
        next.delete(wsId)
        return next
      })
    }
  }

  // 展开/折叠时加载该工作空间的会话
  async function handleToggle(wsId: string) {
    const wasExpanded = expandedIds.has(wsId)
    toggleExpand(wsId)

    if (!wasExpanded && !wsConversations[wsId]) {
      // 首次展开，加载会话
      await loadConversations(wsId)
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
      console.log('[handleNewConversation] response:', json)
      if (json.success && json.data?.conversation) {
        const convId = json.data.conversation.id
        setActiveId(convId)
        // 刷新该工作空间的会话列表，等待完成后再跳转
        await loadConversations(wsId)
        const targetUrl = `/tasks?workspaceId=${wsId}&convId=${convId}`
        console.log('[handleNewConversation] navigating to:', targetUrl)
        router.push(targetUrl)
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
        // 刷新该工作空间的会话列表，等待完成后再跳转
        await loadConversations(wsId)
        // 如果删除的是当前活跃会话，跳转到工作空间任务页
        const activeId = useConversationStore.getState().activeId
        if (activeId === convId) {
          router.push(`/tasks?workspaceId=${wsId}`)
        }
      }
    } catch {
      // 忽略错误
    }
  }

  if (loading && items.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-[#52525b]">加载中...</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-[#52525b]">暂无工作空间</span>
      </div>
    )
  }

  return (
    <div className="py-1 space-y-0.5">
      {items.map((ws) => {
        const isExpanded = expandedIds.has(ws.id)
        const isLoading = loadingWs.has(ws.id)
        const conversations = wsConversations[ws.id]

        return (
          <div key={ws.id}>
            {/* 工作空间一级项 */}
            <div
              className="group flex items-center gap-2 px-3 py-1.5 mx-2 rounded cursor-pointer text-[#a1a1aa] hover:bg-[#27272a]/50 transition-colors"
              onClick={() => handleToggle(ws.id)}
            >
              <ChevronRight
                size={12}
                className={`text-[#52525b] flex-shrink-0 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
              <span className="text-xs flex-1 truncate">{ws.name}</span>
              <span className="text-[10px] text-[#52525b]">
                {conversations ? `${conversations.length}` : ws.conversationCount > 0 ? `${ws.conversationCount}` : ''}
              </span>
              {/* 新建会话按钮 */}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-[#27272a] text-[#52525b] hover:text-[#a1a1aa]"
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
                  <div className="px-3 py-2">
                    <span className="text-[10px] text-[#52525b]">加载中...</span>
                  </div>
                ) : !conversations || conversations.length === 0 ? (
                  <div className="px-3 py-2">
                    <span className="text-[10px] text-[#52525b]">暂无会话</span>
                  </div>
                ) : (
                  conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="group/conv flex items-center gap-2 px-3 py-1 mx-1 rounded cursor-pointer text-[#a1a1aa] hover:bg-[#27272a]/50 transition-colors"
                      onClick={() => handleConvClick(conv.id, ws.id)}
                    >
                      <span className="w-1 h-1 rounded-full bg-[#52525b] opacity-40 flex-shrink-0" />
                      <span className="text-[11px] flex-1 truncate" title={conv.title}>
                        {conv.title}
                      </span>
                      <span className="text-[9px] text-[#52525b] flex-shrink-0 group-hover/conv:hidden">
                        {formatTime(conv.updatedAt)}
                      </span>
                      <button
                        className="hidden group-hover/conv:flex items-center justify-center w-4 h-4 rounded flex-shrink-0 text-[#52525b] hover:text-red-400 transition-colors"
                        onClick={(e) => handleDeleteConversation(ws.id, conv.id, e)}
                        title="删除会话"
                      >
                        <Trash2 size={11} />
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
