/* ConversationList — 会话模式内容列表 */
'use client'

import { useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useConversationStore } from '@/stores/conversation-store'
import { useSidebarStore } from '@/stores/sidebar-store'

export function ConversationList() {
  const router = useRouter()
  const pathname = usePathname()
  const items = useConversationStore((s) => s.items)
  const activeId = useConversationStore((s) => s.activeId)
  const loading = useConversationStore((s) => s.loading)
  const fetchList = useConversationStore((s) => s.fetchList)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const setActiveId = useConversationStore((s) => s.setActiveId)
  const searchQuery = useSidebarStore((s) => s.searchQuery)

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 同步 URL 中的 convId 到 activeId
  useEffect(() => {
    if (pathname.startsWith('/tasks') && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const convId = params.get('convId')
      setActiveId(convId)
    } else {
      setActiveId(null)
    }
  }, [pathname, setActiveId])

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter((c) => c.title.toLowerCase().includes(q))
  }, [items, searchQuery])

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

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await deleteConversation(id)
    if (activeId === id) {
      router.replace('/tasks', { scroll: false })
    }
  }

  function handleClick(id: string) {
    if (activeId === id) return
    setActiveId(id)
    router.replace(`/tasks?convId=${id}`, { scroll: false })
  }

  if (loading && items.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-[#52525b]">加载中...</span>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-[#52525b]">
          {searchQuery ? '无匹配会话' : '暂无会话'}
        </span>
      </div>
    )
  }

  return (
    <div className="py-1 space-y-0.5">
      {filtered.map((conv) => {
        const isActive = activeId === conv.id
        return (
          <div
            key={conv.id}
            className={`group relative flex items-center gap-2 px-3 py-1.5 mx-2 rounded cursor-pointer transition-colors ${
              isActive
                ? 'bg-[#27272a] text-[#fafafa]'
                : 'text-[#a1a1aa] hover:bg-[#27272a]/50'
            }`}
            onClick={() => handleClick(conv.id)}
          >
            {/* 状态点 */}
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                isActive ? 'bg-[#6366f1]' : 'bg-[#52525b] opacity-40'
              }`}
            />
            {/* 标题 */}
            <span
              className={`text-xs flex-1 truncate text-left ${isActive ? 'font-medium' : ''}`}
              title={conv.title}
            >
              {conv.title}
            </span>
            {/* 时间 */}
            <span className="text-[10px] text-[#52525b] flex-shrink-0 group-hover:hidden">
              {formatTime(conv.updatedAt)}
            </span>
            {/* 删除按钮 */}
            <button
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded flex-shrink-0 text-[#52525b] hover:text-red-400 transition-colors"
              onClick={(e) => handleDelete(e, conv.id)}
              title="删除"
            >
              <span className="text-[11px]">×</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
