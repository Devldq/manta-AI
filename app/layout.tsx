import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'ARM · 智能体协作工作台',
  description: '',
}

const NAV_ITEMS = [
  { href: '/kanban', label: '任务看板', icon: '📋' },
  { href: '/approval', label: '审批中心', icon: '✅' },
  { href: '/scoreboard', label: '记分板', icon: '🏆' },
  { href: '/cron', label: '定时任务', icon: '⏰' },
  { href: '/reports', label: '报告中心', icon: '📊' },
  { href: '/agents', label: 'Agent', icon: '🧬' },
  { href: '/skills', label: 'Skills', icon: '📦' }, // AI: Skills 页面入口
  { href: '/workflows', label: '工作流', icon: '⚙️' },
  { href: '/archive', label: '归档阁', icon: '📚' },
  { href: '/ai-news', label: 'AI 要闻', icon: '📰' }, // AI: AI 要闻日报入口
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-screen" style={{ background: '#0f1117' }}>
        {/* AI: 左侧导航栏 */}
        <aside
          className="w-56 flex-shrink-0 flex flex-col border-r"
          style={{ background: '#1a1d27', borderColor: '#2d3148' }}
        >
          {/* AI: Logo / 标题 — 点击回到首页数据面板 */}
          <div className="border-b" style={{ borderColor: '#2d3148' }}>
            <Link
              href="/"
              className="flex items-center gap-2 px-5 py-5 transition-colors hover:bg-[#1e2130]"
              style={{ textDecoration: 'none' }}
            >
              <span className="text-2xl">🏛️</span>
              <div>
                <div className="font-bold text-white text-sm leading-tight">ARM</div>
                <div className="text-xs" style={{ color: '#8892a4' }}>Agent Relationship Manager</div>
              </div>
            </Link>
          </div>

          {/* AI: 导航菜单 */}
          <nav className="flex-1 px-3 py-4 space-y-1">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: '#a0aec0' }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          {/* AI: 底部版本信息 */}
          <div className="px-5 py-3 border-t text-xs" style={{ borderColor: '#2d3148', color: '#4a5568' }}>
            ARM v0.1.0 · OpenClaw
          </div>
        </aside>

        {/* AI: 主内容区 */}
        <main className="flex-1 overflow-auto" style={{ background: '#0f1117' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
