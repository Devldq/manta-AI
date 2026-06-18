/* 会话列表组件 */
import { useState, useEffect } from 'react'
import { MessageSquare, MoreVertical, Trash2, Edit3 } from 'lucide-react'

interface Conversation {
  id: string
  title: string
  agentName: string
  updatedAt: string
}

interface ConversationListProps {
  searchQuery?: string
}

export function ConversationList({ searchQuery = '' }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    // 从 API 获取会话列表
    fetch('/api/conversations?type=single')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setConversations(data.data.conversations)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filteredConversations = conversations.filter(conv =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conv.agentName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (loading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-surface-elevated rounded-md animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1">
      {filteredConversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => setActiveId(conv.id)}
          className={`group flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
            activeId === conv.id
              ? 'bg-accent/10 text-accent'
              : 'text-text-secondary hover:bg-surface-elevated'
          }`}
        >
          <MessageSquare size={16} className="flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{conv.title}</p>
            <p className="text-xs text-text-muted truncate">{conv.agentName}</p>
          </div>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
            <button className="p-1 hover:bg-surface rounded" title="Edit">
              <Edit3 size={12} />
            </button>
            <button className="p-1 hover:bg-surface rounded" title="Delete">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      {filteredConversations.length === 0 && (
        <div className="px-3 py-4 text-center text-text-muted text-sm">
          {searchQuery ? 'No conversations found' : 'No conversations yet'}
        </div>
      )}
    </div>
  )
}
