interface Conversation {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  messages: Array<{
    id: string
    role: string
    content: string
    timestamp: string
  }>
}

interface SessionSidebarProps {
  open: boolean
  conversation: Conversation | null
}

export function SessionSidebar({ open, conversation }: SessionSidebarProps) {
  if (!open) return null

  return (
    <div
      style={{
        width: '320px',
        height: '100%',
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 会话信息 */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          会话详情
        </h3>
        {conversation && (
          <div style={{ marginTop: '12px' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: '4px 0' }}>
              标题: {conversation.title}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0' }}>
              Agent: {conversation.agentName}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', margin: '4px 0' }}>
              消息数: {conversation.messages?.length ?? 0}
            </p>
          </div>
        )}
      </div>

      {/* 工作区内容 */}
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
        <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          工作区内容将在此显示
        </p>
      </div>
    </div>
  )
}
