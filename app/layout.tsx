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
      <head>
        {/*
          AI start: 阻塞式主题注入脚本 — 在任何 HTML 渲染前同步读取 localStorage 并写入 CSS 变量，
          从根本上消除主题闪屏（FOUC）。script 放在 <head> 内同步执行，不等待 React 水合。
        */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var s=localStorage.getItem('manta:theme');if(!s)return;var d=JSON.parse(s);var c=d.config;if(!c)return;var r=document.documentElement;var mode=d.mode||localStorage.getItem('manta:color-mode')||'dark';if(mode==='dark'){r.classList.add('dark');r.classList.remove('light');}else{r.classList.add('light');r.classList.remove('dark');}var keys=['background','surface','surfaceElevated','border','borderSubtle','textPrimary','textSecondary','textMuted','textInverse','accent','accentHover','accentSubtle','emphasis','emphasisHover','success','warning','error','info'];var tokens=['--color-background','--color-surface','--color-surface-elevated','--color-border','--color-border-subtle','--color-text-primary','--color-text-secondary','--color-text-muted','--color-text-inverse','--color-accent','--color-accent-hover','--color-accent-subtle','--color-emphasis','--color-emphasis-hover','--color-status-done','--color-status-pending','--color-status-failed','--color-status-running'];for(var i=0;i<keys.length;i++){if(c[keys[i]])r.style.setProperty(tokens[i],c[keys[i]]);}var rm={'sm':['4px','6px','8px','12px'],'md':['6px','8px','12px','16px'],'lg':['8px','12px','16px','20px'],'xl':['12px','16px','20px','24px']};var rv=rm[c.radius]||rm['md'];r.style.setProperty('--radius-sm',rv[0]);r.style.setProperty('--radius-md',rv[1]);r.style.setProperty('--radius-lg',rv[2]);r.style.setProperty('--radius-xl',rv[3]);if(c.sidebar){r.style.setProperty('--sidebar-bg',c.sidebar.background||'');r.style.setProperty('--sidebar-text',c.sidebar.textPrimary||'');r.style.setProperty('--sidebar-text-secondary',c.sidebar.textSecondary||'');r.style.setProperty('--sidebar-border',c.sidebar.border||'');if(c.sidebar.width)r.style.setProperty('--sidebar-width',c.sidebar.width+'px');if(c.sidebar.collapsedWidth)r.style.setProperty('--sidebar-collapsed-width',c.sidebar.collapsedWidth+'px');}if(c.font&&c.font.family)r.style.setProperty('--font-family',c.font.family);}catch(e){}})();` }} />
        {/* AI end: 阻塞式主题注入脚本 */}
      </head>
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
