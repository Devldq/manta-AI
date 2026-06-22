/* POST /api/tasks/[id]/ai-stream — 启动 Agent Loop（或接入已有循环）
 * GET  /api/tasks/[id]/ai-stream — 重连到已有循环
 *
 * 核心变化：agent loop 与 HTTP 连接完全解耦
 * - POST 启动后台 agent loop 并创建 SSE 连接
 * - GET 从断点重连到已有 SSE 流
 * - 客户端断开不影响 agent loop 继续执行
 */
import { NextRequest } from 'next/server'
import { getTask } from '@/core/storage/task/store'
import { startAgentLoop } from '@/core/engine/stream-handler'
import { formatAIError, formatErrorForSSE } from '@/core/engine/error-formatter'
import { getActiveLoop, subscribeToLoop } from '@/core/engine/loop-registry'
import type { TaskType } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── 辅助：创建 SSE 流式响应 ─────────────────────────────────────────────────

/**
 * 构建完整的 SSE 消息（使用 id: 字段传递 seq，不污染 data JSON）
 * SSE 协议格式:
 *   id: {seq}\n
 *   data: {"type":"text-delta","delta":"Hello"}\n
 *   \n
 *
 * 优势：seq 放在 id: 字段中，不与 AI SDK 的 data JSON schema 冲突
 */
function buildSSEMessage(event: { data: string; seq: number }): string {
  const lines: string[] = []
  // SSE id 字段 — 客户端以此跟踪重连位点
  lines.push(`id: ${event.seq}`)
  // data 保持原样，不做任何 JSON 注入
  lines.push(event.data)
  return lines.join('\n') + '\n'
}

function createSSEResponse(taskId: string, fromSeq: number): Response {
  const encoder = new TextEncoder()

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const unsubscribe = subscribeToLoop(taskId, fromSeq, (event) => {
        try {
          const message = buildSSEMessage(event)
          controller.enqueue(encoder.encode(message))
        } catch {
          // 客户端已断开，取消订阅
          unsubscribe()
        }
      })

      // 监听 loop 结束（通过定时检查 + done 事件结合）
      // scheduleCleanup 会在 30 秒后清理，给重连留窗口
      const loop = getActiveLoop(taskId)
      if (loop) {
        const onDone = () => {
          try { controller.close() } catch { /* ignore */ }
        }
        loop.emitter.on('done', onDone)

        // 如果 loop 已经完成，立即关闭
        if (loop.finished) {
          try { controller.close() } catch { /* ignore */ }
        }
      }
    },
    cancel() {
      // 客户端断开时不取消 loop，只是取消订阅
      // loop 继续在后台运行
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ─── POST：启动 Agent Loop ─────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // 从查询参数获取任务类型
  const type = (req.nextUrl.searchParams.get('type') as TaskType) || 'global'
  const workspaceId = req.nextUrl.searchParams.get('workspaceId') ?? undefined

  // 验证任务存在
  let task = null
  if (type === 'workspace' && workspaceId) {
    task = getTask(id, workspaceId)
  } else {
    task = getTask(id)
  }
  if (!task) {
    return new Response(JSON.stringify({ error: '任务不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 解析请求体
  let body: {
    messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }>
    agentName?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求体解析失败' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { messages, agentName: bodyAgentName } = body
  if (!messages?.length) {
    return new Response(JSON.stringify({ error: 'messages 不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const effectiveAgentName = bodyAgentName || task.agentName

  try {
    // 启动 agent loop（如果已有活跃循环则跳过，但仍创建 SSE 连接）
    await startAgentLoop({
      messages,
      agentName: effectiveAgentName,
      conversationId: id,
      workspaceId: workspaceId,
    })

    // 创建 SSE 流，从当前已广播的事件开始
    return createSSEResponse(id, 0)
  } catch (err) {
    console.error('[ai-stream] fatal error:', err)
    const errorInfo = formatAIError(err)
    const friendlyMessage = formatErrorForSSE(errorInfo)
    return new Response(
      JSON.stringify({ error: friendlyMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

// ─── GET：重连到已有循环 ───────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  // 检查是否有活跃循环
  const loop = getActiveLoop(id)
  if (!loop) {
    return new Response(JSON.stringify({ error: '暂无活跃会话' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 从查询参数获取重连起点序号（客户端上次收到的最后序号）
  const fromSeq = parseInt(req.nextUrl.searchParams.get('fromSeq') ?? '0', 10)

  return createSSEResponse(id, fromSeq)
}
