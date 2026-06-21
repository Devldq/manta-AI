import { memo } from 'react'
import { useFsAccessRequests } from '../hooks/useFsAccessRequests'

export const FsAccessBanner = memo(function FsAccessBanner() {
  const { requests, respond } = useFsAccessRequests()
  if (requests.length === 0) return null

  return (
    <div style={{ padding: '0 20px 8px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {requests.map((req) => (
        <div key={req.id} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', borderRadius: '10px',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          fontSize: '13px',
          animation: 'tool-log-in var(--duration-fast) var(--ease-out-quart) both',
        }}>
          <span style={{ fontSize: '16px' }}>🔒</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
              Agent 申请访问目录
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {req.path}
            </div>
          </div>
          <button
            onClick={() => respond(req.id, 'grant')}
            className="transition-all duration-fast"
            style={{ padding: '5px 14px', borderRadius: '7px', border: 'none', background: 'var(--color-accent)', color: 'var(--color-text-inverse)', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)' }}>
            批准
          </button>
          <button
            onClick={() => respond(req.id, 'deny')}
            className="transition-all duration-fast"
            style={{ padding: '5px 14px', borderRadius: '7px', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)' }}>
            拒绝
          </button>
        </div>
      ))}
    </div>
  )
})
