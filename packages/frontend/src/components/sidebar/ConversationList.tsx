/* ConversationList — 任务分组列表（独立会话，无工作空间归属）*/

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Square, ChevronRight } from 'lucide-react'
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
  const [collapsed, setCollapsed] = useState(false)

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

  // 仅显示独立会话（无工作空间归属）
  const standaloneItems = useMemo(() => {
    const filtered = items.filter((c) => !c.workspaceId)
    if (!searchQuery.trim()) return filtered
    const q = searchQuery.toLowerCase()
    return filtered.filter((c) => c.title.toLowerCase().includes(q))
  }, [items, searchQuery])

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
      {/* ── 任务分组头（可折叠，固定不滚动） ── */}
      <div
        className="flex items-center justify-between pl-3 pr-1 py-1 cursor-pointer hover:bg-border/30 rounded transition-colors flex-shrink-0"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-1.5">
          <ChevronRight
            size={12}
            className={`text-text-muted flex-shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className={`text-xs font-medium text-text-muted uppercase select-none ${collapsed ? '' : 'text-sidebar-text'}`}>任务</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-0.5 rounded hover:bg-border text-text-muted hover:text-sidebar-text-secondary mr-2"
            onClick={(e) => { e.stopPropagation(); handleNewAction() }}
            title="新建任务"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {!collapsed && (
        standaloneItems.length === 0 ? (
          <div className="px-4 py-2 flex-shrink-0">
            <span className="text-[11px] text-text-muted">
              {searchQuery ? '无匹配任务' : '暂无任务'}
            </span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-none px-0.5">
            {standaloneItems.map((conv) => {
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
                  {/* Checkbox 图标 */}
                  <Square size={15} className={`flex-shrink-0 ${isActive ? 'text-accent' : 'text-text-muted'}`} />
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
      )}
    </div>
  )
}