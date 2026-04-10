import type { Metadata } from 'next'
import './globals.css'
import { SidebarNav } from './components/SidebarNav'
import { ThemeInitializer } from './components/ThemeInitializer'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: 服务启动时执行一次 Manta agent 注入（Server Component 在首次渲染时执行）
async function bootstrapInject() {
  const mantaAgentsDir = path.join(os.homedir(), 'manta-data', 'agents')
  if (!fs.existsSync(mantaAgentsDir)) return
  try {
    // AI: 直接调用注入逻辑（server-side，不经过 HTTP）
    await fetch('http://localhost:3000/api/agents/inject', {
      method: 'POST',
      cache: 'no-store',
    }).catch(() => { /* 服务还未完全就绪时忽略错误 */ })
  } catch { /* 忽略启动期错误 */ }
}

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
        {/* AI: 全局主题初始化 — 任何页面加载时都从 localStorage 恢复主题配置 */}
        <ThemeInitializer />
        {/*
          AI: manta-main-container — 壁纸通过 ::before 伪元素铺底，
          背景色透明度 (--main-bg-opacity) 控制壁纸透出程度，无额外蒙层 div
        */}
        <div className="manta-main-container flex h-screen overflow-hidden">
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
