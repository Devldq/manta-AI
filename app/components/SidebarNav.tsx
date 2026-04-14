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
  { href: '/',           label: '首页',   icon: '◎' },
  { href: '/kanban',     label: '看板',   icon: '▦' },
  { href: '/workflows',  label: '编排',   icon: '⟳' },
  { href: '/agents',     label: 'Agent', icon: '◉' },
]

// AI: 任务状态类型
type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

// AI: v6 WorkBuddy风格 - 状态图标映射
const STATUS_ICONS: Record<TaskStatus, string> = {
  done: '✓',
  running: '⏳',
  planning: '⚡',
  inbox: '⭕',
  failed: '❌',
  archived: '📦'
}

interface Task {
  id: string
  title: string
  status: TaskStatus
  createdAt?: string
  updatedAt?: string
}

export function SidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  // AI: 当前颜色模式
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('dark')
  // AI: 设置弹窗开关
  const [settingsOpen, setSettingsOpen] = useState(false)
  // AI: v6 WorkBuddy风格 - 搜索查询
  const [searchQuery, setSearchQuery] = useState('')
  // AI: v6 WorkBuddy风格 - 任务标签默认展开
  const [tasksExpanded, setTasksExpanded] = useState(true)
  // AI: v3 所有未归档任务列表
  const [allTasks, setAllTasks] = useState<Task[]>([])
  // AI: v4 当前选中的任务ID（本地状态，立即响应点击）
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  useEffect(() => {
    // AI: 从 localStorage 读取颜色模式
    const stored = localStorage.getItem('manta:color-mode') as 'light' | 'dark' | null
    if (stored === 'light' || stored === 'dark') {
      setColorMode(stored)
    } else {
      setColorMode(getSystemColorMode())
    }

    // AI: v6 WorkBuddy风格 - 任务标签默认展开，无需判断路径
    // 移除: if (pathname.startsWith('/tasks')) setTasksExpanded(true)

    // AI: v4 从 URL 同步 selectedTaskId（处理刷新/直接访问场景）
    if (pathname === '/tasks' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const urlTaskId = params.get('taskId')
      setSelectedTaskId(urlTaskId)
    } else if (!pathname.startsWith('/tasks')) {
      // AI: 离开任务页面时清空选中状态
      setSelectedTaskId(null)
    }
  }, [pathname])

  // AI: v3 加载所有未归档任务
  useEffect(() => {
    if (!tasksExpanded) return

    async function fetchAllTasks() {
      try {
        const res = await fetch('/api/tasks')
        const data = await res.json()
        const tasks = data.tasks ?? []
        // AI: 显示所有未归档任务，按时间降序
        const active = tasks
          .filter((t: Task) => t.status !== 'archived')
          .sort((a: Task, b: Task) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        setAllTasks(active)
      } catch {
        setAllTasks([])
      }
    }

    fetchAllTasks()
    // AI: 展开时轮询刷新（每5秒）
    const timer = setInterval(fetchAllTasks, 5000)
    return () => clearInterval(timer)
  }, [tasksExpanded])

  // AI: v7 改进新建任务流程 - 先打开聊天窗口，输入内容后再创建
  function openNewTaskChat() {
    // 跳转到任务页面并标记为新建模式
    router.push('/tasks?new=true')
  }

  // AI: v6 WorkBuddy风格 - 相对时间格式化
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

  // AI: v6 WorkBuddy风格 - 搜索过滤任务
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return allTasks
    const query = searchQuery.toLowerCase()
    return allTasks.filter(t => t.title.toLowerCase().includes(query))
  }, [allTasks, searchQuery])

  // AI: 切换亮暗模式
  function handleColorModeChange(newMode: 'light' | 'dark') {
    setColorMode(newMode)
    setColorModeClass(newMode)
    localStorage.setItem('manta:color-mode', newMode)

    // AI: 同时切换当前主题的对应模式
    const saved = loadThemeFromStorage()
    const themeId = saved?.themeId ?? 'cli-pixel'
    const theme = getThemeById(themeId) ?? DESIGN_THEMES[0]
    const config = getThemeConfig(theme, newMode)
    applyTheme(config)
    saveThemeToStorage(themeId, config, newMode)
  }

  return (
    <>
      {/* AI: 侧边栏容器，壁纸通过 CSS 变量 + ::before/::after 伪元素实现（见 globals.css） */}
      <aside
        className="manta-sidebar flex flex-col flex-shrink-0"
        style={{ width: 'var(--sidebar-width)', borderRight: '1px solid var(--color-border)' }}
      >
        {/* AI: v6 WorkBuddy风格 Logo 区域 - 版本号在右侧 */}
        <div
          style={{ height: 'var(--header-height)', borderBottom: '1px solid var(--color-border)' }}
          className="flex items-center justify-between px-5 flex-shrink-0"
        >
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            {/* AI: Logo 图标 */}
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
              style={{
                background: 'var(--color-accent)',
                boxShadow: '0 0 8px var(--color-accent)',
              }}
            >
              <span style={{ color: '#050507', fontSize: '11px', fontWeight: 700 }}>M</span>
            </div>
            <span
              style={{
                color: 'var(--color-text-primary)',
                fontWeight: 600,
                fontSize: '14px',
                letterSpacing: '-0.3px',
              }}
            >
              Manta
            </span>
          </Link>
          {/* AI: v6 WorkBuddy风格 - 版本号 */}
          <span
            style={{
              color: 'var(--color-text-muted)',
              fontSize: '11px',
              fontWeight: 400,
            }}
          >
            v2.0.0
          </span>
        </div>

        {/* AI: v6 WorkBuddy风格 - 搜索区域 */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div 
              className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" 
              style={{ 
                background: 'var(--color-surface)', 
                border: '1px solid var(--color-border)',
                minWidth: 0  // 关键：允许 flex 子元素缩小
              }}
            >
              <span style={{ color: 'var(--color-text-muted)', fontSize: '13px', flexShrink: 0 }}>🔍</span>
              <input
                type="text"
                placeholder="搜索任务"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none"
                style={{ 
                  color: 'var(--color-text-primary)',
                  minWidth: 0  // 关键：防止输入框撑开容器
                }}
              />
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-accent-subtle)'
                e.currentTarget.style.borderColor = 'var(--color-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              <span style={{ fontSize: '13px' }}>⚙️</span>
            </button>
          </div>
        </div>

        {/* AI: v6 WorkBuddy风格 - 新建任务按钮 */}
        <div className="px-3 pb-2 flex-shrink-0">
          <button
            onClick={openNewTaskChat}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all"
            style={{ background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--color-accent)'
              e.currentTarget.style.color = 'var(--color-text-inverse)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--color-accent-subtle)'
              e.currentTarget.style.color = 'var(--color-text-primary)'
            }}
          >
            <span style={{ fontSize: '13px' }}>✏️</span>
            <span style={{ fontSize: '13px', fontWeight: 500 }}>新建任务</span>
          </button>
        </div>

        {/* 导航链接 */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              // AI: 首页精确匹配，其他页面前缀匹配
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href)

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
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'var(--color-accent-subtle)'
                      e.currentTarget.style.color = 'var(--color-text-primary)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'var(--color-text-secondary)'
                    }
                  }}
                >
                  <span
                    style={{
                      fontSize: '11px',
                      width: '16px',
                      textAlign: 'center',
                      color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: isActive ? 500 : 400 }}>{item.label}</span>
                </Link>
              )
            })}

            {/* AI: v6 WorkBuddy风格 - 任务标签（可折叠，默认展开） */}
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button
                onClick={() => setTasksExpanded(!tasksExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors hover:bg-[var(--color-accent-subtle)]"
              >
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                  任务
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    transition: 'transform 150ms',
                    transform: tasksExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  ▾
                </span>
              </button>

              {/* AI: v6 WorkBuddy风格 - 任务列表 */}
              {tasksExpanded && (
                <div className="mt-1 space-y-0.5">
                  {filteredTasks.length === 0 ? (
                    <div className="px-3 py-2 text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>
                      {searchQuery ? '无匹配任务' : '暂无任务'}
                    </div>
                  ) : (
                    filteredTasks.map((task) => {
                      // AI: v5 只使用本地状态判断高亮
                      const isActive = pathname === '/tasks' && selectedTaskId === task.id

                      return (
                        <button
                          key={task.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isActive) return
                            setSelectedTaskId(task.id)
                            router.replace(`/tasks?taskId=${task.id}`, { scroll: false })
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-all"
                          style={{
                            color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                            background: isActive ? 'var(--color-accent)' : 'transparent',
                            cursor: isActive ? 'default' : 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.background = 'var(--color-accent-subtle)'
                              e.currentTarget.style.color = 'var(--color-text-primary)'
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) {
                              e.currentTarget.style.background = 'transparent'
                              e.currentTarget.style.color = 'var(--color-text-secondary)'
                            }
                          }}
                        >
                          {/* AI: v6 WorkBuddy风格 - 状态图标 */}
                          <span
                            style={{
                              fontSize: '12px',
                              width: '14px',
                              flexShrink: 0,
                              textAlign: 'center',
                            }}
                          >
                            {STATUS_ICONS[task.status]}
                          </span>
                          {/* AI: v6 WorkBuddy风格 - 任务标题（截断） */}
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: isActive ? 500 : 400,
                              flex: 1,
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={task.title}
                          >
                            {task.title}
                          </span>
                          {/* AI: v6 WorkBuddy风格 - 相对时间 */}
                          <span
                            style={{
                              fontSize: '10px',
                              color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
                              flexShrink: 0,
                            }}
                          >
                            {formatRelativeTime(task.updatedAt || task.createdAt)}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </nav>
      </aside>

      {/* AI: 设置弹窗 */}
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
