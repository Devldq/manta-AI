import { useEffect } from 'react'
import { useConversationStore } from '@/stores/conversation-store'
import { ListTodo } from 'lucide-react'

export default function TasksPage() {
  const { items: conversations, fetchList } = useConversationStore()

  useEffect(() => {
    fetchList()
  }, [fetchList])

  return (
    <div className="flex h-screen">
      {/* 侧边栏 */}
      <aside className="w-64 border-r border-border bg-surface p-4">
        <h1 className="text-lg font-semibold text-text-primary mb-6">Manta</h1>
        <nav className="space-y-1">
          <a href="/tasks" className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-subtle text-accent">
            <ListTodo size={16} />
            任务
          </a>
          <a href="/apps" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            智能体应用
          </a>
          <a href="/workspace" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            工作空间
          </a>
          <a href="/mcp" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            MCP
          </a>
          <a href="/settings" className="flex items-center gap-2 px-3 py-2 rounded-md text-text-secondary hover:bg-surface-elevated">
            设置
          </a>
        </nav>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-text-primary mb-6">任务</h2>
          
          {conversations.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <ListTodo size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无任务</p>
              <p className="text-sm mt-2">创建一个新的对话开始吧</p>
            </div>
          ) : (
            <div className="space-y-3">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className="p-4 rounded-lg border border-border bg-surface hover:bg-surface-elevated transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-text-primary">{conv.title}</h3>
                    <span className="text-xs text-text-muted">
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1">
                    {conv.agentName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
