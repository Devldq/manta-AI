/**
 * Stream Chunk Transformer — 将 AI SDK fullStream 的 TextStreamPart 转换为 UIMessageChunk 格式
 *
 * 根因：agent-loop.ts 直接转发 fullStream 的原始 chunk 给客户端，
 * 但客户端 DefaultChatTransport 使用 UIMessageChunk Zod strictObject schema 解析，
 * 导致 start-step（含 request/warnings）等 chunk 验证失败。
 *
 * 本模块提供 transformChunk() 函数，逐个转换 fullStream chunk 为客户端可接受的格式。
 */

import { logger } from '@observability/log'

/** 生成唯一 ID（使用随机后缀，避免多请求并发冲突） */
function genId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ---- 类型定义（仅用于转换逻辑，不需要从 ai 包导入） ----

/** fullStream 中可能出现的 chunk 类型 */
type FullStreamChunk = {
  type: string
  // 各 chunk 的具体字段以 unknown 处理，按 type 分支提取
  [key: string]: unknown
}

/** UIMessageChunk 格式的输出（匹配客户端 Zod schema） */
type UIMessageChunkOutput = {
  type: string
  [key: string]: unknown
}

/**
 * 将单个 fullStream chunk 转换为 UIMessageChunk 格式
 * 不匹配的 chunk 类型返回 null（应跳过不转发）
 */
export function transformChunk(
  chunk: FullStreamChunk,
  conversationId?: string,
  messageId?: string,
): UIMessageChunkOutput | null {
  switch (chunk.type) {
    // ---- 直接匹配的类型 ----

    case 'text-start':
      return { type: 'text-start', id: (chunk.id as string) || genId() }

    case 'text-end':
      return { type: 'text-end', id: (chunk.id as string) || genId() }

    case 'reasoning-start':
      return { type: 'reasoning-start', id: (chunk.id as string) || genId() }

    case 'reasoning-end':
      return { type: 'reasoning-end', id: (chunk.id as string) || genId() }

    // ---- 需要字段重映射的类型 ----

    case 'text-delta':
      // fullStream: { type, id, text } → UIMessageChunk: { type, id, delta }
      return { type: 'text-delta', id: (chunk.id as string) || genId(), delta: chunk.text as string }

    case 'reasoning-delta':
      // fullStream: { type, id, text } → UIMessageChunk: { type, id, delta }
      return { type: 'reasoning-delta', id: (chunk.id as string) || genId(), delta: chunk.text as string }

    case 'tool-input-start':
      // fullStream 用 id，UIMessageChunk 用 toolCallId
      return {
        type: 'tool-input-start',
        toolCallId: (chunk.id as string) || genId(),
        toolName: chunk.toolName as string,
      }

    case 'tool-input-delta':
      // fullStream: { id, delta } → UIMessageChunk: { toolCallId, inputTextDelta }
      return {
        type: 'tool-input-delta',
        toolCallId: (chunk.id as string) || genId(),
        inputTextDelta: chunk.delta as string,
      }

    case 'tool-call':
      // fullStream tool-call → UIMessageChunk tool-input-available
      return {
        type: 'tool-input-available',
        toolCallId: chunk.toolCallId as string,
        toolName: chunk.toolName as string,
        input: chunk.args ?? chunk.input,
      }

    case 'tool-result':
      // fullStream tool-result → UIMessageChunk tool-output-available
      // AI SDK v6: chunk.output 是工具返回值（不是 chunk.result）
      return {
        type: 'tool-output-available',
        toolCallId: chunk.toolCallId as string,
        output: (chunk as any).output,
      }

    case 'tool-error':
      // fullStream tool-error → UIMessageChunk tool-output-error
      return {
        type: 'tool-output-error',
        toolCallId: chunk.toolCallId as string,
        errorText: typeof chunk.error === 'string' ? chunk.error : String(chunk.error ?? 'Unknown tool error'),
      }

    case 'tool-output-denied':
      return {
        type: 'tool-output-denied',
        toolCallId: chunk.toolCallId as string,
      }

    case 'tool-approval-request':
      return {
        type: 'tool-approval-request',
        approvalId: chunk.approvalId as string,
        toolCallId: chunk.toolCallId as string,
      }

    // ---- 需要精简（去掉额外字段）的类型 ----

    case 'start-step':
      // 关键修复：fullStream 含 request/warnings，UIMessageChunk 只允许 { type: "start-step" }
      return { type: 'start-step' }

    case 'finish-step':
      // 关键修复：fullStream 含 response/usage/finishReason 等，UIMessageChunk 只允许 { type: "finish-step" }
      return { type: 'finish-step' }

    case 'start':
      // 注意：start 事件由 agent-loop.ts 在循环开始时统一发送一次
      // 这里返回 null 避免每个 step 都触发新的消息气泡
      return null

    case 'finish':
      // fullStream: { type, finishReason, totalUsage, rawFinishReason } → UIMessageChunk: { type, finishReason? }
      return { type: 'finish', finishReason: chunk.finishReason as string | undefined }

    case 'abort':
      return { type: 'abort', reason: chunk.reason as string | undefined }

    case 'error':
      // error chunk 由 agent-loop.ts 统一格式化处理（formatAIError）后再发送
      // 此处返回 null 避免重复转发未格式化的原始错误
      return null

    // ---- source / file 需要判断子类型 ----

    case 'source':
      if (chunk.sourceType === 'url') {
        return {
          type: 'source-url',
          sourceId: chunk.sourceId as string,
          url: chunk.url as string,
          title: chunk.title as string | undefined,
        }
      }
      return {
        type: 'source-document',
        sourceId: chunk.sourceId as string,
        mediaType: chunk.mediaType as string,
        title: chunk.title as string,
      }

    case 'file':
      return {
        type: 'file',
        url: chunk.url as string,
        mediaType: chunk.mediaType as string,
      }

    // ---- 不应转发给客户端的类型 ----

    case 'raw':
    case 'tool-input-end':
      // 这些类型不在 UIMessageChunk schema 中，跳过
      return null

    default:
      // 未识别的 chunk 类型：安全跳过，避免客户端 schema 验证失败
      logger.warn(`[stream-transformer] Unknown chunk type: ${chunk.type}, skipping`, {
        conversationId,
        messageId,
        chunkType: chunk.type,
      }, ['stream', 'transformer', 'unknown-chunk'])
      return null
  }
}