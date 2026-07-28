import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceLogEntry, WorkspaceLogFileResponse } from './types'
import { mergeWorkspaceLogs } from './workspace-logs'

interface UseWorkspaceLogsOptions {
  conversationId?: string
  workspaceId?: string | null
  enabled?: boolean
}

export function useWorkspaceLogs({
  conversationId,
  workspaceId,
  enabled = true,
}: UseWorkspaceLogsOptions) {
  const [logs, setLogs] = useState<WorkspaceLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const offsetRef = useRef(0)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || !conversationId) {
      offsetRef.current = 0
      setLogs([])
      setLoading(false)
      setError(null)
      setConnected(false)
      return
    }

    const controller = new AbortController()
    let initialized = false
    let inFlight = false
    offsetRef.current = 0
    setLogs([])
    setLoading(true)
    setError(null)
    setConnected(false)

    const poll = async () => {
      if (controller.signal.aborted || inFlight) return
      inFlight = true
      const initial = !initialized
      const query = new URLSearchParams({ conversationId })
      if (workspaceId) query.set('workspaceId', workspaceId)
      if (initial) query.set('tail', '200')
      else query.set('offset', String(offsetRef.current))

      try {
        const response = await fetch(`/api/logs/file?${query}`, { signal: controller.signal })
        const data = await response.json() as WorkspaceLogFileResponse
        if (!response.ok) throw new Error(data.error || `日志请求失败 (${response.status})`)
        if (!Array.isArray(data.entries) || typeof data.offset !== 'number') {
          throw new Error('日志响应格式无效')
        }
        offsetRef.current = data.offset
        setLogs((current) => mergeWorkspaceLogs(current, data.entries, initial || data.reset === true))
        initialized = true
        setConnected(true)
        setError(null)
      } catch (reason) {
        if (controller.signal.aborted) return
        setConnected(false)
        setError(reason instanceof Error ? reason.message : '无法读取日志')
      } finally {
        inFlight = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), 1_500)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [conversationId, enabled, refreshKey, workspaceId])

  return { logs, loading, error, connected, refresh }
}
