/* 会话侧边栏组件 */
import { useState } from 'react'
import { MessageSquare, Plus, Search, MoreVertical, Trash2 } from 'lucide-react'

interface Session {
  id: string
  title: string
  lastMessage: string
  timestamp: string
}

interface SessionSidebarProps {
  sessions: Session[]
  activeSessionId: string | null
  onSessionSelect: (id: string) => void
  onSessionDelete: (id: string) => void
  onNewSession: () => void
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  onSessionDelete,
  onNewSession
}: SessionSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSessions = sessions.filter(session =>
    session.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    session.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="w-64 h-full flex flex-col bg-surface border-r border-border">
      {/* 头部 */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" size={14} />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            onClick={onNewSession}
            className="p-1.5 bg-accent hover:bg-accent-hover rounded-md transition-colors"
            title="New Session"
          >
            <Plus size={14} className="text-text-inverse" />
          </button>
        </div>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className={`group flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors ${
              activeSessionId === session.id
                ? 'bg-accent/10 text-accent'
                : 'text-text-secondary hover:bg-surface-elevated'
            }`}
            onClick={() => onSessionSelect(session.id)}
          >
            <MessageSquare size={16} className="flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.title}</p>
              <p className="text-xs text-text-muted truncate">{session.lastMessage}</p>
              <p className="text-xs text-text-muted mt-1">
                {new Date(session.timestamp).toLocaleTimeString()}
              </p>
            </div>
            <button
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface rounded transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                onSessionDelete(session.id)
              }}
              title="Delete session"
            >
              <Trash2 size={12} className="text-text-muted" />
            </button>
          </div>
        ))}

        {filteredSessions.length === 0 && (
          <div className="px-2 py-4 text-center text-text-muted text-sm">
            {searchQuery ? 'No sessions found' : 'No sessions yet'}
          </div>
        )}
      </div>
    </div>
  )
}
