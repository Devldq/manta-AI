import { NextResponse } from 'next/server'

// AI: 首页重定向到任务看板
export default function HomePage() {
  return (
    <div className="flex items-center justify-center h-full min-h-screen" style={{ background: '#0f1117' }}>
      <div className="text-center">
        <div className="text-6xl mb-4">🏛️</div>
        <h1 className="text-2xl font-bold text-white mb-2">ARM 控制台</h1>
        <p className="text-sm mb-6" style={{ color: '#8892a4' }}>前端研发工作流 · 多 Agent 协作</p>
        <a
          href="/kanban"
          className="inline-block px-6 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: '#3b82f6', color: '#fff' }}
        >
          进入任务看板 →
        </a>
      </div>
    </div>
  )
}
