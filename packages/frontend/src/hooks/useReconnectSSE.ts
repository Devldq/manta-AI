/**
 * useReconnectSSE — 当页面刷新或切换回有活跃 agent loop 的会话时自动重连 SSE
 *
 * 核心逻辑：
 * 1. 组件挂载时尝试 GET /api/conversations/{id}/ai-stream
 * 2. 如果返回 200 + text/event-stream，说明有活跃循环，开始消费 SSE
 * 3. 解析 SSE 事件为消息 chunks，供 ChatView 渲染
 * 4. 循环结束后自动标记完成
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { UIMessage } from 'ai'

export interface ReconnectStreamState {
  /** 是否已连接上活跃循环 */
  connected: boolean
  /** 是否正在重连中 */
  reconnecting: boolean
  /** 重连期间收到的消息 parts（动态累积） */
  streamingParts: UIMessage['parts']
  /** 流是否已完成 */
  finished: boolean
  /** 错误信息 */
  error: string | null
}

/**
 * 自动重连到活跃 agent loop 的 SSE 流
 * @param convId 会话 ID
 * @param enabled 是否启用重连（通常当 useChat 处于 ready 状态时启用）
 * @param workspaceId 工作空间 ID（可选，用于工作空间会话）
 */
export function useReconnectSSE(convId: string, enabled: boolean, workspaceId?: string | null) {
  const [state, setState] = useState<ReconnectStreamState>({
    connected: false,
    reconnecting: false,
    streamingParts: [],
    finished: false,
    error: null,
  })

  const abortRef = useRef<AbortController | null>(null)
  // 跟踪从 SSE 事件中接收到的最后 seq（用于精确重连）
  const lastSeqRef = useRef(0)

  // sessionStorage key for this conversation's last seq
  const storedSeqKey = `manta:seq:${convId}`

  const connect = useCallback(async () => {
    if (!convId) return

    setState(s => ({ ...s, reconnecting: true, error: null }))

    const controller = new AbortController()
    abortRef.current = controller

    // 从 sessionStorage 读取上次断开时的最后 seq
    const storedSeq = parseInt(sessionStorage.getItem(storedSeqKey) ?? '0', 10) || 0
    // 如果当前 ref 中有更新的 seq，优先使用
    const fromSeq = Math.max(lastSeqRef.current, storedSeq)

    // 构建 URL，支持工作空间会话
    const typeParam = workspaceId ? '&type=workspace' : ''
    const wsParam = workspaceId ? `&workspaceId=${workspaceId}` : ''
    const url = `/api/conversations/${convId}/ai-stream?fromSeq=${fromSeq}${typeParam}${wsParam}`

    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      })

      // 如果不是 SSE，说明没有活跃循环
      const contentType = res.headers.get('content-type') ?? ''
      if (!res.ok || contentType.includes('application/json')) {
        setState(s => ({ ...s, reconnecting: false, connected: false }))
        return
      }

      if (!res.body) {
        setState(s => ({ ...s, reconnecting: false, error: '无法读取响应流' }))
        return
      }

      setState(s => ({ ...s, connected: true, reconnecting: false, streamingParts: [] }))

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 解析 SSE 行
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // 保留最后一个不完整行

        for (const line of lines) {
          // 从 SSE id: 字段读取 seq（用于精确重连位点）
          if (line.startsWith('id: ')) {
            const seq = parseInt(line.slice(4).trim(), 10)
            if (!isNaN(seq) && seq > lastSeqRef.current) {
              lastSeqRef.current = seq
            }
            continue
          }

          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim()
            if (!dataStr || dataStr === '[DONE]') continue

            try {
              const event = JSON.parse(dataStr)

              if (event.type === 'error') {
                setState(s => ({
                  ...s,
                  error: event.errorText ?? '发生未知错误',
                  finished: true,
                }))
                return
              }

              // 将 SSE 事件转换为 UIMessage part
              const part = sseEventToPart(event)
              if (part) {
                setState(s => ({
                  ...s,
                  streamingParts: mergeStreamingParts(s.streamingParts, part),
                }))
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      // 流自然结束 — 保存最后 seq 以便未来重连
      sessionStorage.setItem(storedSeqKey, String(lastSeqRef.current))
      setState(s => ({ ...s, finished: true }))
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // 组件卸载或手动断开 — 保存最后 seq 以便重连
        sessionStorage.setItem(storedSeqKey, String(lastSeqRef.current))
        setState(s => ({ ...s, reconnecting: false }))
        return
      }
      sessionStorage.setItem(storedSeqKey, String(lastSeqRef.current))
      setState(s => ({ ...s, reconnecting: false, error: (err as Error).message }))
    }
  }, [convId, storedSeqKey, workspaceId])

  useEffect(() => {
    if (!enabled) return

    connect()

    return () => {
      sessionStorage.setItem(storedSeqKey, String(lastSeqRef.current))
      abortRef.current?.abort()
    }
  }, [enabled, connect])

  /** 重置重连状态（loop 结束、手动刷新后） */
  const reset = useCallback(() => {
    sessionStorage.setItem(storedSeqKey, String(lastSeqRef.current))
    abortRef.current?.abort()
    lastSeqRef.current = 0
    setState({
      connected: false,
      reconnecting: false,
      streamingParts: [],
      finished: false,
      error: null,
    })
    // 清除 sessionStorage 中的 seq（loop 已结束，不需要重连）
    sessionStorage.removeItem(storedSeqKey)
  }, [storedSeqKey])

  return { ...state, reset }
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 将 SSE 事件对象转换为 UIMessage part */
function sseEventToPart(event: Record<string, unknown>): UIMessage['parts'][number] | null {
  const type = event.type as string
  if (!type) return null

  switch (type) {
    case 'text-start':
      return null // 流式元数据，不存入 parts（AI SDK 内部管理 text-start/text-end 状态）
    case 'text-delta':
      return {
        type: 'text' as const,
        text: (event.delta ?? event.text ?? '') as string,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'text-end':
      return null // 流式元数据，不存入 parts
    case 'tool-input-start':
      return {
        type: 'dynamic-tool' as const,
        toolCallId: event.toolCallId as string,
        toolName: event.toolName as string,
        state: 'input-streaming',
        input: undefined,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'tool-input-delta':
      return {
        type: 'dynamic-tool' as const,
        toolCallId: event.toolCallId as string,
        toolName: '',
        state: 'input-streaming',
        input: (event.inputTextDelta as string) ?? '',
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'tool-input-available':
      return {
        type: 'dynamic-tool' as const,
        toolCallId: event.toolCallId as string,
        toolName: event.toolName as string,
        state: 'input-available',
        input: event.input,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'tool-output-available':
      return {
        type: 'dynamic-tool' as const,
        toolCallId: event.toolCallId as string,
        toolName: '',
        state: 'output-available',
        output: event.output,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'tool-output-error':
      return {
        type: 'dynamic-tool' as const,
        toolCallId: event.toolCallId as string,
        toolName: '',
        state: 'output-error',
        errorText: event.errorText as string,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'start-step':
      return {
        type: 'step-start' as const,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'finish-step':
      return {
        type: 'step-end' as const,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'finish':
      return {
        type: 'finish' as const,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    case 'abort':
      return {
        type: 'abort' as const,
      } as unknown as NonNullable<UIMessage['parts']>[number]
    default:
      return null
  }
}

/**
 * 将新的 SSE part 合并到现有流式 parts 中
 * text-delta → 追加到最后一个 text part
 * tool-input-delta → 追加到对应 toolCallId 的 input
 * tool-input-available → 替换对应 toolCallId
 * tool-output-* → 添加新的 tool part
 * tool-input-start → 添加新的 tool part
 */
function mergeStreamingParts(
  existing: UIMessage['parts'],
  incoming: UIMessage['parts'][number],
): UIMessage['parts'] {
  const parts = [...existing]
  const incomingAny = incoming as Record<string, unknown>

  if (incomingAny.type === 'text') {
    // 找到最后一个 text part 并追加
    const lastText = parts.filter(p => p.type === 'text').pop()
    if (lastText && typeof lastText === 'object' && 'text' in lastText) {
      ;(lastText as Record<string, unknown>).text = String(lastText.text ?? '') + String(incomingAny.text ?? '')
    } else {
      parts.push(incoming)
    }
  } else if (incomingAny.type === 'dynamic-tool') {
    const idx = parts.findIndex(
      p => {
        const pAny = p as Record<string, unknown>
        return pAny.type === 'dynamic-tool' && pAny.toolCallId === incomingAny.toolCallId
      }
    )
    if (idx >= 0 && incomingAny.state === 'input-streaming') {
      // 更新已有的 tool part
      const existing2 = parts[idx] as Record<string, unknown>
      if (typeof incomingAny.input === 'string') {
        existing2.input = String(existing2.input ?? '') + String(incomingAny.input)
      }
      existing2.state = incomingAny.state
    } else if (idx >= 0) {
      // 替换
      parts[idx] = incoming
    } else {
      parts.push(incoming)
    }
  } else {
    parts.push(incoming)
  }

  return parts
}
