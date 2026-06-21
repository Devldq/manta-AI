/* ConversationList — 会话模式内容列表 */

import { useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useConversationStore } from '@/stores/conversation-store'
import { useSidebarStore } from '@/stores/sidebar-store'

export function ConversationList() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const items = useConversationStore((s) => s.items)
  const activeId = useConversationStore((s) => s.activeId)
  const loading = useConversationStore((s) => s.loading)
  const fetchList = useConversationStore((s) => s.fetchList)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const setActiveId = useConversationStore((s) => s.setActiveId)
  const searchQuery = useSidebarStore((s) => s.searchQuery)

  // SidebarNav 已在顶层预触发 fetchList，这里作为 fallback 确保数据加载
  useEffect(() => {
    if (items.length === 0 && !loading) {
      fetchList()
    }
  }, [fetchList, items.length, loading])

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
    // 如果删除的是当前活跃会话，立即跳转
    if (activeId === id) {
      navigate('/tasks', { replace: true })
    }
    // 后台删除（deleteConversation 内部会乐观更新本地状态）
    deleteConversation(id)
  }

  function handleClick(id: string) {
    if (activeId === id) return
    setActiveId(id)
    navigate(`/tasks?convId=${id}`, { replace: true })
  }

  // 移除骨架屏，直接显示内容或空状态
  // if (loading && items.length === 0) {
  //   return <SkeletonSidebarList itemCount={5} />
  // }

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <span className="text-[11px] text-text-muted">
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
                ? 'bg-border text-sidebar-text'
                : 'text-sidebar-text-secondary hover:bg-border/50'
            }`}
            onClick={() => handleClick(conv.id)}
          >
            {/* 状态点 */}
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                isActive ? 'bg-accent' : 'bg-text-muted opacity-40'
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
            <span className="text-[10px] text-text-muted flex-shrink-0 group-hover:hidden">
              {formatTime(conv.updatedAt)}
            </span>
            {/* 删除按钮 */}
            <button
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded flex-shrink-0 text-text-muted hover:text-status-failed transition-colors"
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