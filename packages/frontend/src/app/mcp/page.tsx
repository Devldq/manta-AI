import { Plug } from 'lucide-react'

export default function McpPage() {
  return (
    <div className="flex h-screen">
      <aside className="w-64 border-r border-border bg-surface p-4">
        <h1 className="text-lg font-semibold text-text-primary mb-6">Manta</h1>
        <nav className="space-y-1">
          <a href="/tasks" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            任务
          </a>
          <a href="/apps" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            智能体应用
          </a>
          <a href="/workspace" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            工作空间
          </a>
          <a href="/mcp" className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-subtle text-accent">
            <Plug size={16} />
            MCP
          </a>
          <a href="/settings" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            设置
          </a>
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-text-primary mb-6">MCP 服务器</h2>
          <div className="text-center py-12 text-text-muted">
            <Plug size={48} className="mx-auto mb-4 opacity-50" />
            <p>MCP 服务器管理</p>
          </div>
        </div>
      </main>
    </div>
  )
}
