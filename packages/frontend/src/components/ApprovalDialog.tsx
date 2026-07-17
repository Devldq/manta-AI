/**
 * ApprovalDialog - 运行时授权弹窗组件
 * 
 * 当工具需要访问允许范围外的路径或执行需要授权的命令时，
 * 会显示此弹窗请求用户授权。
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  mergePendingApproval,
  removePendingApproval,
  replacePendingApprovals,
  type PendingApproval,
} from './approval-state'

interface ApprovalDialogProps {
  onRespond?: (requestId: string, action: 'approve' | 'deny') => void
}

export function ApprovalDialog({ onRespond }: ApprovalDialogProps) {
  const [requests, setRequests] = useState<PendingApproval[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const currentRequest = requests[0] ?? null

  useEffect(() => {
    let disposed = false
    let eventSource: EventSource | null = null

    const connectSSE = () => {
      if (disposed) return
      eventSource = new EventSource('/api/approval/sse')

      eventSource.onopen = () => {
        console.log('[ApprovalDialog] SSE 连接已建立')
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'connected') {
            console.log('[ApprovalDialog] SSE 连接成功，连接 ID:', data.connectionId)
          } else if (data.type === 'approval-snapshot') {
            setRequests(replacePendingApprovals(data.requests ?? []))
          } else if (data.type === 'approval-request') {
            const request: PendingApproval = data.request
            setRequests((previous) => mergePendingApproval(previous, request))
          } else if (data.type === 'approval-response') {
            const { id, status } = data.request
            console.log(`[ApprovalDialog] 授权请求 ${id} 已${status === 'approved' ? '批准' : '拒绝'}`)
            setRequests((previous) => removePendingApproval(previous, id))
          }
        } catch (error) {
          console.error('[ApprovalDialog] 解析 SSE 消息失败:', error)
        }
      }

      eventSource.onerror = (error) => {
        console.error('[ApprovalDialog] SSE 连接错误:', error)
        // EventSource 会使用服务端 retry 或浏览器默认退避自动重连。
      }
    }

    // 先恢复 REST 快照，再连接 SSE。SSE 建连快照会覆盖两者之间发生的状态变化。
    void fetch('/api/approval/pending')
      .then(async (response) => {
        if (!response.ok) throw new Error('加载待处理授权请求失败')
        return response.json() as Promise<{ requests?: PendingApproval[] }>
      })
      .then((data) => {
        if (!disposed) setRequests(replacePendingApprovals(data.requests ?? []))
      })
      .catch((error) => {
        if (!disposed) console.error('[ApprovalDialog] 恢复待处理请求失败:', error)
      })
      .finally(connectSSE)

    return () => {
      disposed = true
      eventSource?.close()
    }
  }, [])

  // 响应授权请求
  const handleRespond = async (requestId: string, action: 'approve' | 'deny') => {
    if (respondingId) return
    setRespondingId(requestId)
    try {
      const response = await fetch(`/api/approval/${requestId}/respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      })

      if (!response.ok) {
        throw new Error('响应授权请求失败')
      }

      setRequests((previous) => removePendingApproval(previous, requestId))

      // 回调
      onRespond?.(requestId, action)
    } catch (error) {
      console.error('[ApprovalDialog] 响应授权请求失败:', error)
      alert('响应授权请求失败，请重试')
    } finally {
      setRespondingId(null)
    }
  }

  // 如果没有待处理的请求，不渲染任何内容
  if (!currentRequest) {
    return null
  }

  // 获取操作类型的中文描述
  const getActionText = () => {
    switch (currentRequest.type) {
      case 'read':
        return '读取'
      case 'write':
        return '写入'
      case 'shell':
        return '执行命令'
      default:
        return '操作'
    }
  }

  // 获取详情信息
  const getDetailText = () => {
    if (currentRequest.path) {
      return `路径: ${currentRequest.path}`
    }
    if (currentRequest.command) {
      return `命令: ${currentRequest.command}`
    }
    return ''
  }

  return createPortal(
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <span style={iconStyle}>🔐</span>
          <h3 style={titleStyle}>授权请求</h3>
        </div>

        <div style={contentStyle}>
          <p style={messageStyle}>
            Agent 请求<strong>{getActionText()}</strong>操作，是否允许？
          </p>
          <p style={detailStyle}>{getDetailText()}</p>
          <p style={hintStyle}>
            如果不确定，建议选择"拒绝"
          </p>
        </div>

        <div style={buttonContainerStyle}>
          <button
            style={denyButtonStyle}
            disabled={respondingId === currentRequest.id}
            onClick={() => handleRespond(currentRequest.id, 'deny')}
          >
            拒绝
          </button>
          <button
            style={approveButtonStyle}
            disabled={respondingId === currentRequest.id}
            onClick={() => handleRespond(currentRequest.id, 'approve')}
          >
            允许
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// 样式
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
}

const dialogStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  borderRadius: '8px',
  padding: '24px',
  maxWidth: '500px',
  width: '90%',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px',
}

const iconStyle: React.CSSProperties = {
  fontSize: '24px',
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: '#ffffff',
}

const contentStyle: React.CSSProperties = {
  marginBottom: '24px',
}

const messageStyle: React.CSSProperties = {
  color: '#cccccc',
  fontSize: '14px',
  marginBottom: '12px',
}

const detailStyle: React.CSSProperties = {
  color: '#aaaaaa',
  fontSize: '13px',
  backgroundColor: '#2a2a2a',
  padding: '8px 12px',
  borderRadius: '4px',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  marginBottom: '12px',
}

const hintStyle: React.CSSProperties = {
  color: '#888888',
  fontSize: '12px',
  fontStyle: 'italic',
}

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
}

const baseButtonStyle: React.CSSProperties = {
  padding: '8px 24px',
  borderRadius: '4px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
}

const denyButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#3a3a3a',
  color: '#ffffff',
}

const approveButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  backgroundColor: '#007acc',
  color: '#ffffff',
}
