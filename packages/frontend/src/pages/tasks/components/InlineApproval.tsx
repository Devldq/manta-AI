import { useEffect, useState } from 'react'
import { Check, Clock3, ShieldAlert, X } from 'lucide-react'
import { useApprovals } from '@/components/ApprovalProvider'
import type { PendingApproval } from '@/components/approval-state'

function getActionLabel(request: PendingApproval): string {
  switch (request.type) {
    case 'read':
      return '读取外部文件'
    case 'write':
      return '写入外部文件'
    case 'shell':
      return '执行风险命令'
  }
}

function getDetail(request: PendingApproval): { label: string; value: string } | null {
  if (request.command) return { label: '命令', value: request.command }
  if (request.path) return { label: '路径', value: request.path }
  return null
}

export function InlineApproval() {
  const { requests, respondingId, responseError, respond } = useApprovals()
  const current = requests[0] ?? null
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!current?.expiresAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [current?.id, current?.expiresAt])

  if (!current) return null

  const detail = getDetail(current)
  const secondsRemaining = current.expiresAt
    ? Math.max(0, Math.ceil((current.expiresAt - now) / 1_000))
    : null
  const isResponding = respondingId === current.id

  return (
    <section
      className="approval-inline-card"
      aria-labelledby={`approval-title-${current.id}`}
      aria-describedby={`approval-detail-${current.id}`}
      aria-live="polite"
    >
      <div className="approval-inline-heading">
        <span className="approval-inline-icon" aria-hidden="true">
          <ShieldAlert size={17} strokeWidth={1.8} />
        </span>
        <div className="approval-inline-copy">
          <div className="approval-inline-title-row">
            <strong id={`approval-title-${current.id}`}>需要你的确认</strong>
            {requests.length > 1 && (
              <span className="approval-inline-count">{requests.length} 项待审批</span>
            )}
          </div>
          <span>Agent 请求{getActionLabel(current)}</span>
        </div>
      </div>

      <div id={`approval-detail-${current.id}`} className="approval-inline-detail">
        {detail && (
          <>
            <span>{detail.label}</span>
            <code title={detail.value}>{detail.value}</code>
          </>
        )}
        <span className="approval-inline-timeout">
          <Clock3 size={12} aria-hidden="true" />
          {secondsRemaining === null
            ? '未设置超时'
            : secondsRemaining > 0
              ? `${secondsRemaining} 秒后自动拒绝`
              : '正在自动拒绝'}
        </span>
      </div>

      <div className="approval-inline-actions">
        <button
          type="button"
          className="approval-inline-button approval-inline-deny"
          disabled={isResponding}
          onClick={() => void respond(current.id, 'deny')}
        >
          <X size={14} aria-hidden="true" />
          {isResponding ? '处理中' : '拒绝'}
        </button>
        <button
          type="button"
          className="approval-inline-button approval-inline-approve"
          disabled={isResponding}
          onClick={() => void respond(current.id, 'approve')}
        >
          <Check size={14} aria-hidden="true" />
          {isResponding ? '处理中' : '允许'}
        </button>
      </div>

      {responseError && (
        <p className="approval-inline-error" role="alert">{responseError}</p>
      )}
    </section>
  )
}
