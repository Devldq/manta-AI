/**
 * AgentLoopRegistry — 管理活跃的 agent 循环（支持 SSE 断线重连）
 *
 * 核心设计：
 * - Agent loop 与 HTTP 连接完全解耦，运行在独立的后台异步任务中
 * - Loop 输出通过 EventEmitter 广播，任意数量的 SSE 连接可订阅
 * - 客户端断开后 loop 继续执行，重连时从缓冲区补发缺失事件
 * - 每个对话最多一个活跃 loop，通过 conversationId 索引
 */
import { EventEmitter } from 'events'

// ─── 类型 ──────────────────────────────────────────────────────────────────────

/** 循环事件类型（与 SSE 传输格式一致） */
export interface LoopEvent {
  /** 事件序号（单调递增，用于重连定位） */
  seq: number
  /** 事件时间戳 */
  timestamp: number
  /** SSE data 行内容（JSON 字符串） */
  data: string
}

/** 活跃循环状态 */
export interface ActiveLoop {
  /** 事件发射器（所有订阅者通过此 emitter 接收实时事件） */
  emitter: EventEmitter
  /** 事件缓冲区（环形/无限，用于重连补发） */
  buffer: LoopEvent[]
  /** 用户主动停止专用（不与 HTTP 请求生命周期绑定） */
  abortController: AbortController
  /** 后台运行的 agent loop Promise */
  running: Promise<void>
  /** 循环是否已完成或出错 */
  finished: boolean
  /** 当前事件序号 */
  seq: number
}

// ─── 配置 ──────────────────────────────────────────────────────────────────────

/** 事件缓冲区最大条数（避免内存无限增长） */
const MAX_BUFFER_SIZE = 1000

// ─── 注册表 ────────────────────────────────────────────────────────────────────

/** conversationId → ActiveLoop */
const loops = new Map<string, ActiveLoop>()

/**
 * 检查指定会话是否有活跃的 agent 循环
 */
export function hasActiveLoop(conversationId: string): boolean {
  const loop = loops.get(conversationId)
  return !!loop && !loop.finished
}

/**
 * 获取指定会话的活跃循环（不存在则返回 undefined）
 */
export function getActiveLoop(conversationId: string): ActiveLoop | undefined {
  const loop = loops.get(conversationId)
  if (loop && !loop.finished) return loop
  return undefined
}

/**
 * 注册一个新的活跃循环
 * 如果该会话已有活跃循环则抛出错误（调用方应先检查）
 */
export function registerLoop(conversationId: string, running: Promise<void>): ActiveLoop {
  if (loops.has(conversationId) && !loops.get(conversationId)!.finished) {
    throw new Error(`Conversation ${conversationId} already has an active loop`)
  }

  const loop: ActiveLoop = {
    emitter: new EventEmitter(),
    buffer: [],
    abortController: new AbortController(),
    running,
    finished: false,
    seq: 0,
  }

  loops.set(conversationId, loop)

  // 当 loop 完成（成功或失败）时标记 finished
  running
    .then(() => {
      loop.finished = true
      loop.emitter.emit('done')
    })
    .catch(() => {
      loop.finished = true
      loop.emitter.emit('done')
    })

  return loop
}

/**
 * 向活跃循环推送一个事件（由 agent loop 调用）
 */
export function emitLoopEvent(conversationId: string, data: string): void {
  const loop = loops.get(conversationId)
  if (!loop || loop.finished) return

  const event: LoopEvent = {
    seq: ++loop.seq,
    timestamp: Date.now(),
    data,
  }

  // 写入缓冲区（FIFO，保留最近 MAX_BUFFER_SIZE 条）
  loop.buffer.push(event)
  if (loop.buffer.length > MAX_BUFFER_SIZE) {
    loop.buffer.shift()
  }

  // 广播给所有订阅者
  loop.emitter.emit('event', event)
}

/**
 * 订阅活跃循环的事件流
 * @param conversationId 会话 ID
 * @param fromSeq 从该序号开始接收事件（用于重连），0 表示从头开始
 * @param onEvent 事件回调
 * @returns 取消订阅函数
 */
export function subscribeToLoop(
  conversationId: string,
  fromSeq: number,
  onEvent: (event: LoopEvent) => void,
): () => void {
  const loop = loops.get(conversationId)
  if (!loop) throw new Error(`No active loop for conversation ${conversationId}`)

  // 1. 补发缓冲区中的历史事件
  for (const event of loop.buffer) {
    if (event.seq >= fromSeq) {
      onEvent(event)
    }
  }

  // 2. 如果 loop 已完成，直接通知完成
  if (loop.finished) {
    // 延迟通知让调用方有时间设置
    setImmediate(() => onEvent({ seq: loop.seq + 1, timestamp: Date.now(), data: 'done' }))
    return () => {}
  }

  // 3. 订阅实时事件
  const handler = (event: LoopEvent) => {
    if (event.seq >= fromSeq) {
      onEvent(event)
    }
  }
  loop.emitter.on('event', handler)

  return () => {
    loop.emitter.off('event', handler)
  }
}

/**
 * 获取活跃循环的当前最新序号
 */
export function getCurrentSeq(conversationId: string): number {
  const loop = loops.get(conversationId)
  return loop?.seq ?? 0
}

/**
 * 用户主动停止指定会话的 agent 循环
 */
export function stopLoop(conversationId: string): boolean {
  const loop = loops.get(conversationId)
  if (!loop || loop.finished) return false
  loop.abortController.abort()
  return true
}

/**
 * 清理已完成的循环（由 subscriber 在 done 事件后调用）
 * 注意：不立即清理，因为重连客户端可能还需要缓冲区
 * 延迟 30 秒后自动清理
 */
export function scheduleCleanup(conversationId: string): void {
  setTimeout(() => {
    const loop = loops.get(conversationId)
    if (loop?.finished) {
      loop.emitter.removeAllListeners()
      loops.delete(conversationId)
    }
  }, 30_000) // 30 秒保留期
}
