/**
 * ApprovalDialog - 运行时授权弹窗组件
 * 
 * 当工具需要访问允许范围外的路径或执行需要授权的命令时，
 * 会显示此弹窗请求用户授权。
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface ApprovalRequest {
  id: string
  type: 'read' | 'write' | 'shell'
  path?: string
  command?: string
  requestedBy: string
  createdAt: number
}

interface ApprovalDialogProps {
  onRespond?: (requestId: string, action: 'approve' | 'deny') => void
}

export function ApprovalDialog({ onRespond }: ApprovalDialogProps) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [currentRequest, setCurrentRequest] = useState<ApprovalRequest | null>(null)
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set())

  // 连接到 SSE 端点
  const connectSSE = useCallback(() => {
    const eventSource = new EventSource('/api/approval/sse')

    eventSource.onopen = () => {
      console.log('[ApprovalDialog] SSE 连接已建立')
    }

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'connected') {
          console.log('[ApprovalDialog] SSE 连接成功，连接 ID:', data.connectionId)
        } else if (data.type === 'approval-request') {
          // 收到授权请求
          const request: ApprovalRequest = data.request
          
          // 如果已经响应过，忽略
          if (respondedIds.has(request.id)) {
            return
          }

          console.log('[ApprovalDialog] 收到授权请求:', request)
          setRequests((prev) => [...prev, request])
          
          // 如果没有当前显示的请求，显示这个
          if (!currentRequest) {
            setCurrentRequest(request)
          }
        } else if (data.type === 'approval-response') {
          // 授权请求已响应（可能是其他客户端响应的）
          const { id, status } = data.request
          console.log(`[ApprovalDialog] 授权请求 ${id} 已${status === 'approved' ? '批准' : '拒绝'}`)
          
          // 从待处理列表中移除
          setRequests((prev) => prev.filter((r) => r.id !== id))
          if (currentRequest?.id === id) {
            setCurrentRequest(null)
          }
        }
      } catch (error) {
        console.error('[ApprovalDialog] 解析 SSE 消息失败:', error)
      }
    }

    eventSource.onerror = (error) => {
      console.error('[ApprovalDialog] SSE 连接错误:', error)
      eventSource.close()
      
      // 5 秒后重连
      setTimeout(connectSSE, 5000)
    }

    return eventSource
  }, [currentRequest, respondedIds])

  // 组件挂载时连接 SSE
  useEffect(() => {
    const eventSource = connectSSE()

    return () => {
      eventSource.close()
    }
  }, [connectSSE])

  // 响应授权请求
  const handleRespond = async (requestId: string, action: 'approve' | 'deny') => {
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

      // 标记为已响应
      setRespondedIds((prev) => new Set([...prev, requestId]))

      // 从待处理列表中移除
      setRequests((prev) => prev.filter((r) => r.id !== requestId))
      
      if (currentRequest?.id === requestId) {
        setCurrentRequest(null)
      }

      // 回调
      onRespond?.(requestId, action)
    } catch (error) {
      console.error('[ApprovalDialog] 响应授权请求失败:', error)
      alert('响应授权请求失败，请重试')
    }
  }

  // 当有请求待处理且当前没有显示的请求时，显示第一个
  useEffect(() => {
    if (!currentRequest && requests.length > 0) {
      setCurrentRequest(requests[0])
    }
  }, [requests, currentRequest])

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
            onClick={() => handleRespond(currentRequest.id, 'deny')}
          >
            拒绝
          </button>
          <button
            style={approveButtonStyle}
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
