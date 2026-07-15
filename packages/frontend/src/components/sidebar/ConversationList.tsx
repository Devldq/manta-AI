/* ConversationList — 任务分组列表（独立会话，无工作空间归属）*/

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, ChevronRight, Trash2 } from 'lucide-react'
import { useConversationStore } from '@/stores/conversation-store'
import { useSidebarStore } from '@/stores/sidebar-store'

export function claimConversationFallback(itemsLength: number, loading: boolean, requested: { current: boolean }): boolean {
  if (requested.current || itemsLength > 0 || loading) return false
  requested.current = true
  return true
}

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
  const [collapsed, setCollapsed] = useState(false)
  const fallbackRequested = useRef(false)

  // SidebarNav 已在顶层预触发 fetchList，这里作为 fallback 确保数据加载
  useEffect(() => {
    if (claimConversationFallback(items.length, loading, fallbackRequested)) void fetchList()
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

  // 仅显示独立会话（无工作空间归属）
  const standaloneItems = useMemo(() => {
    const filtered = items.filter((c) => !c.workspaceId)
    if (!searchQuery.trim()) return filtered
    const q = searchQuery.toLowerCase()
    return filtered.filter((c) => c.title.toLowerCase().includes(q))
  }, [items, searchQuery])

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (activeId === id) {
      navigate('/tasks', { replace: true })
    }
    deleteConversation(id)
  }

  function handleClick(id: string) {
    if (activeId === id) return
    setActiveId(id)
    navigate(`/tasks?convId=${id}`, { replace: true })
  }

  function handleNewAction() {
    navigate('/tasks')
  }

  return (
    <div className={`flex-shrink-0 flex flex-col overflow-hidden ${collapsed ? '' : 'max-h-[40%]'}`}>
      <div
        className="mx-2.5 mt-1 flex items-center justify-between py-0.5 cursor-pointer transition-colors flex-shrink-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronRight
            size={11}
            className={`text-text-muted flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className={`text-[12px] font-semibold text-text-muted select-none ${collapsed ? '' : 'text-sidebar-text-secondary'}`}>任务</span>
          {!collapsed && standaloneItems.length > 0 && (
            <span className="text-[11px] text-text-muted leading-none">
              {standaloneItems.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-70 hover:opacity-100">
          <button
            className="mr-0.5 flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-border/50 hover:text-sidebar-text-secondary transition-colors"
            onClick={(e) => { e.stopPropagation(); handleNewAction() }}
            title="新建任务"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        standaloneItems.length === 0 ? (
          <div className="px-3 py-1 flex-shrink-0">
            <span className="text-[12px] text-text-muted">
              {searchQuery ? '无匹配任务' : '暂无任务'}
            </span>
          </div>
        ) : (
          <div className="sidebar-scrollbar flex-1 overflow-y-auto px-2 pb-0.5">
            {standaloneItems.map((conv) => {
              const isActive = activeId === conv.id
              return (
                <div
                  key={conv.id}
                  className={`group relative mb-px flex items-center gap-1.5 rounded-md px-2 py-0.5 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-border/45 text-sidebar-text'
                      : 'text-sidebar-text-secondary hover:bg-border/20'
                  }`}
                  onClick={() => handleClick(conv.id)}
                >
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12px] text-left leading-snug ${isActive ? 'font-semibold text-sidebar-text' : 'font-medium'}`}
                      title={conv.title}
                    >
                      {conv.title}
                    </span>
                  </div>
                  <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 pointer-events-none hover:bg-status-failed/10 hover:text-status-failed transition-colors group-hover:opacity-100 group-hover:pointer-events-auto"
                      onClick={(e) => handleDelete(e, conv.id)}
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
