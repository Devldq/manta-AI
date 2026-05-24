/* AI start: Manta 侧边导航 — Client Component，usePathname 实现活跃高亮 + 亮暗切换 */
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { setColorModeClass, getSystemColorMode } from './ThemeInitializer'
import { applyTheme, loadThemeFromStorage, getThemeById, getThemeConfig, DESIGN_THEMES, saveThemeToStorage } from '../lib/theme-presets'
import { SettingsModal } from './SettingsModal'

const NAV_ITEMS = [
  { href: '/mcp', label: 'MCP', icon: '⎈' },
]

// AI: LLM 聊天会话类型
interface Conversation {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
}

export function SidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [conversationsExpanded, setConversationsExpanded] = useState(true)
  // AI: LLM 聊天会话列表（只展示 chat 模式）
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    setColorMode(stored === 'light' || stored === 'dark' ? stored : getSystemColorMode())

    if (pathname.startsWith('/tasks') && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setSelectedId(params.get('convId'))
    } else {
      setSelectedId(null)
    }
  }, [pathname])

  // AI: 获取 LLM 聊天会话列表（只展示 chat 模式）
  useEffect(() => {
    if (!conversationsExpanded) return

    async function fetchConversations() {
      try {
        const res = await fetch('/api/conversations')
        const data = await res.json()
        setConversations(data.conversations ?? [])
      } catch {
        setConversations([])
      }
    }

    fetchConversations()
    const timer = setInterval(fetchConversations, 5000)
    return () => clearInterval(timer)
  }, [conversationsExpanded])

  function openNewConversation() {
    router.push('/tasks')
  }

  async function handleDeleteConversation(e: React.MouseEvent, convId: string) {
    e.stopPropagation()
    setDeletingId(convId)
    try {
      await fetch(`/api/conversations/${convId}`, { method: 'DELETE' })
      setConversations((prev) => prev.filter((c) => c.id !== convId))
      // 若删除的是当前选中会话，跳回 /tasks
      if (selectedId === convId) {
        setSelectedId(null)
        router.replace('/tasks', { scroll: false })
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  function formatRelativeTime(date?: string) {
    if (!date) return ''
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN })
        .replace('大约 ', '')
        .replace(' 前', '')
    } catch {
      return ''
    }
  }

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations
    const q = searchQuery.toLowerCase()
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, searchQuery])

  function handleColorModeChange(newMode: 'light' | 'dark') {
    setColorMode(newMode)
    setColorModeClass(newMode)
    localStorage.setItem('manta:color-mode', newMode)
    const saved = loadThemeFromStorage()
    const themeId = saved?.themeId ?? 'cli-pixel'
    const theme = getThemeById(themeId) ?? DESIGN_THEMES[0]
    const config = getThemeConfig(theme, newMode)
    applyTheme(config)
    saveThemeToStorage(themeId, config, newMode)
  }

  return (
    <>
      <aside
        className="manta-sidebar flex flex-col flex-shrink-0"
        style={{ width: 'var(--sidebar-width)', borderRight: '1px solid var(--color-border)' }}
      >
        {/* Logo */}
        <div
          style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}
          className="flex items-center justify-between px-5 flex-shrink-0"
        >
          <Link href="/tasks" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)' }}
            >
              <span style={{ color: '#050507', fontSize: '11px', fontWeight: 700 }}>M</span>
            </div>
            <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '14px', letterSpacing: '-0.3px' }}>
              Manta
            </span>
          </Link>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>v2.0.0</span>
        </div>

        {/* 搜索 */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 0 }}
            >
              <span style={{ color: 'var(--color-text-muted)', fontSize: '13px', flexShrink: 0 }}>🔍</span>
              <input
                type="text"
                placeholder="检索"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ color: 'var(--color-text-primary)', minWidth: 0 }}
              />
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.borderColor = 'var(--color-accent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--color-border)' }}
            >
              <span style={{ fontSize: '13px' }}>⚙️</span>
            </button>
          </div>
        </div>

        {/* 新建会话 */}
        <div className="px-3 pb-2 flex-shrink-0">
          <button
            onClick={openNewConversation}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all"
            style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-text-inverse)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
          >
            <span style={{ fontSize: '13px' }}>✏️</span>
            <span style={{ fontSize: '13px', fontWeight: 500 }}>新建会话</span>
          </button>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 py-4 flex flex-col overflow-hidden">
          {/* 固定导航项 */}
          <div className="space-y-0.5 flex-shrink-0">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-150"
                  style={{
                    color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                    background: isActive ? 'var(--color-accent)' : 'transparent',
                    borderLeft: '2px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-text-primary)' } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
                >
                  <span style={{ fontSize: '11px', width: '16px', textAlign: 'center', color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
                </Link>
              )
            })}
          </div>

          {/* 会话列表（可滚动区域）*/}
          <div className="mt-3 pt-3 flex-1 flex flex-col overflow-hidden" style={{ borderTop: '1px solid var(--color-border)' }}>
            {/* 标题行：会话 + 展开/折叠 */}
            <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0">
              <button
                onClick={() => setConversationsExpanded(!conversationsExpanded)}
                className="flex items-center gap-1.5"
              >
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>会话</span>
                <span style={{ fontSize: '10px', transition: 'transform 150ms', transform: conversationsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', color: 'var(--color-text-muted)' }}>▾</span>
              </button>
            </div>

            {conversationsExpanded && (
              <div className="mt-1 flex-1 overflow-y-auto space-y-0.5 scrollbar-none">
                {filteredConversations.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
                    {searchQuery ? '无匹配会话' : '暂无会话'}
                  </div>
                ) : (
                  filteredConversations.map((conv) => {
                    const isActive = pathname.startsWith('/tasks') && selectedId === conv.id
                    return (
                      <div
                        key={conv.id}
                        className="group relative flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all"
                        style={{
                          color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                          background: isActive ? 'var(--color-accent)' : 'transparent',
                          cursor: isActive ? 'default' : 'pointer',
                        }}
                        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--color-accent-subtle)'; e.currentTarget.style.color = 'var(--color-text-primary)' } }}
                        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' } }}
                        onClick={() => {
                          if (isActive) return
                          setSelectedId(conv.id)
                          router.replace(`/tasks?convId=${conv.id}`, { scroll: false })
                        }}
                      >
                        <span style={{ fontSize: '12px', width: '14px', flexShrink: 0, textAlign: 'center' }}>
                          💬
                        </span>
                        <span
                          style={{ fontSize: '11px', fontWeight: isActive ? 500 : 400, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={conv.title}
                        >
                          {conv.title}
                        </span>
                        <span style={{ fontSize: '10px', color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)', flexShrink: 0 }} className="group-hover:hidden">
                          {formatRelativeTime(conv.updatedAt)}
                        </span>
                        <button
                          className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded flex-shrink-0 transition-colors"
                          style={{ color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)' }}
                          onClick={(e) => handleDeleteConversation(e, conv.id)}
                          disabled={deletingId === conv.id}
                          title="删除会话"
                        >
                          <span style={{ fontSize: '11px' }}>{deletingId === conv.id ? '…' : '×'}</span>
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </nav>
      </aside>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        colorMode={colorMode}
        onColorModeChange={handleColorModeChange}
      />
    </>
  )
}
/* AI end: SidebarNav 结束 */
