import type { Metadata } from 'next'
import './globals.css'
import { SidebarNav } from './components/SidebarNav'

/* AI start: Manta 根布局 — Server Component，Sidebar 抽出为独立 Client Component */
export const metadata: Metadata = {
  title: 'Manta',
  description: 'Agent 调度操作系统 · Humans steer. Agents execute. Drivers are pluggable.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="flex h-screen overflow-hidden bg-background">
          {/* AI: SidebarNav 是独立的 Client Component，支持 usePathname 活跃高亮 */}
          <SidebarNav />
          {/* 主内容区 */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
/* AI end: 根布局结束 */
