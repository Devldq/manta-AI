'use client'

import { useState, useEffect } from 'react'

interface AccessRequest {
  id: string
  path: string
  status: 'pending' | 'granted' | 'denied'
  requestedAt: number
}

export function useFsAccessRequests() {
  const [requests, setRequests] = useState<AccessRequest[]>([])

  useEffect(() => {
    let timer: NodeJS.Timeout
    let interval = 1500

    const poll = async () => {
      try {
        const res = await fetch('/api/fs/request-access')
        const data: AccessRequest[] = await res.json()
        setRequests(data)

        // 没有待处理请求时延长轮询间隔
        if (data.length === 0) {
          interval = Math.min(interval * 2, 30000) // 最大30秒
        } else {
          interval = 1500
        }
      } catch {
        // 出错时保持当前间隔
      }
      timer = setTimeout(poll, interval)
    }

    poll()
    return () => clearTimeout(timer)
  }, [])

  async function respond(requestId: string, action: 'grant' | 'deny') {
    await fetch('/api/fs/grant-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, action }),
    })
    setRequests((prev) => prev.filter((r) => r.id !== requestId))
  }

  return { requests, respond }
}
