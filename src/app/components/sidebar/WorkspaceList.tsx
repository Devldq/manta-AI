/* WorkspaceList — 工作空间模式内容列表（支持二级展开） */
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
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

  // 展开时加载该工作空间的会话
  async function handleToggle(wsId: string) {
    const wasExpanded = expandedIds.has(wsId)
    toggleExpand(wsId)

    if (!wasExpanded && !wsConversations[wsId]) {
      // 首次展开，加载会话
      setLoadingWs((prev) => new Set(prev).add(wsId))
      try {
        const res = await fetch(`/api/workspaces/${wsId}/conversations`)
        if (res.ok) {
          const data = await res.json()
          setWsConversations((prev) => ({ ...prev, [wsId]: data.conversations ?? [] }))
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

  function handleConvClick(convId: string) {
    setActiveId(convId)
    router.push(`/tasks?convId=${convId}`)
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
                      className="flex items-center gap-2 px-3 py-1 mx-1 rounded cursor-pointer text-[#a1a1aa] hover:bg-[#27272a]/50 transition-colors"
                      onClick={() => handleConvClick(conv.id)}
                    >
                      <span className="w-1 h-1 rounded-full bg-[#52525b] opacity-40 flex-shrink-0" />
                      <span className="text-[11px] flex-1 truncate" title={conv.title}>
                        {conv.title}
                      </span>
                      <span className="text-[9px] text-[#52525b] flex-shrink-0">
                        {formatTime(conv.updatedAt)}
                      </span>
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
