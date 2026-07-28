import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  mergePendingApproval,
  removePendingApproval,
  replacePendingApprovals,
  type PendingApproval,
} from './approval-state'

type ApprovalAction = 'approve' | 'deny'

interface ApprovalContextValue {
  requests: PendingApproval[]
  respondingId: string | null
  responseError: string
  respond: (requestId: string, action: ApprovalAction) => Promise<void>
}

const ApprovalContext = createContext<ApprovalContextValue | null>(null)

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<PendingApproval[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const [responseError, setResponseError] = useState('')
  const respondingRef = useRef<string | null>(null)

  useEffect(() => {
    let disposed = false
    let eventSource: EventSource | null = null

    const connectSSE = () => {
      if (disposed) return
      eventSource = new EventSource('/api/approval/sse')
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type?: string
            requests?: PendingApproval[]
            request?: PendingApproval & { status?: 'approved' | 'denied' }
          }
          if (data.type === 'approval-snapshot') {
            setRequests(replacePendingApprovals(data.requests ?? []))
            setResponseError('')
          } else if (data.type === 'approval-request' && data.request) {
            setRequests((previous) => mergePendingApproval(previous, data.request!))
            setResponseError('')
          } else if (data.type === 'approval-response' && data.request?.id) {
            setRequests((previous) => removePendingApproval(previous, data.request!.id))
            setResponseError('')
          }
        } catch (error) {
          console.error('[ApprovalProvider] 无法解析审批事件:', error)
        }
      }
      eventSource.onerror = () => {
        // EventSource 使用服务端 retry 自动重连；重连快照会清除失效请求。
      }
    }

    void fetch('/api/approval/pending')
      .then(async (response) => {
        if (!response.ok) throw new Error('待审批请求恢复失败')
        return response.json() as Promise<{ requests?: PendingApproval[] }>
      })
      .then((data) => {
        if (!disposed) setRequests(replacePendingApprovals(data.requests ?? []))
      })
      .catch((error) => {
        if (!disposed) {
          console.error('[ApprovalProvider] 恢复待审批请求失败:', error)
        }
      })
      .finally(connectSSE)

    return () => {
      disposed = true
      eventSource?.close()
    }
  }, [])

  const respond = useCallback(async (requestId: string, action: ApprovalAction) => {
    if (respondingRef.current) return
    respondingRef.current = requestId
    setRespondingId(requestId)
    setResponseError('')
    try {
      const response = await fetch(`/api/approval/${requestId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json() as {
        error?: string
        stale?: boolean
        request?: { id: string; status: 'pending' | 'approved' | 'denied' }
      }
      if (!response.ok) throw new Error(data.error || '审批提交失败')

      // 只相信服务端的最终状态。多窗口竞态下，本次点击可能已经失效。
      if (data.stale || (data.request && data.request.status !== 'pending')) {
        setRequests((previous) => removePendingApproval(previous, requestId))
      }
    } catch (error) {
      setResponseError(error instanceof Error ? error.message : '审批提交失败，请重试')
    } finally {
      respondingRef.current = null
      setRespondingId(null)
    }
  }, [])

  const value = useMemo<ApprovalContextValue>(() => ({
    requests,
    respondingId,
    responseError,
    respond,
  }), [requests, respondingId, responseError, respond])

  return (
    <ApprovalContext.Provider value={value}>
      {children}
    </ApprovalContext.Provider>
  )
}

export function useApprovals(): ApprovalContextValue {
  const value = useContext(ApprovalContext)
  if (!value) throw new Error('useApprovals 必须在 ApprovalProvider 内使用')
  return value
}
