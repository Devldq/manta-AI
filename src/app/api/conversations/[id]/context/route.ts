/* GET /api/conversations/[id]/context — 上下文状态快照
 *
 * 重建传给大模型的真实上下文，包含：
 * - System Prompt 各 Pipe 段落及 token 估算
 * - 每一步 Agent Loop 的消息列表摘要（角色、内容长度、是否被清理）
 * - Microcompact / Compaction 执行效果
 * - 总 Token 估算
 */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getConversation } from '@storage/conversation/store'
import { loadContextSnapshots, type ContextStepSnapshot as CoreContextStepSnapshot } from '@context/context-snapshot'
import { estimateTokensFromChars } from '@context/token/estimator'

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface PipeSection {
  name: string
  enabled: boolean
  charCount: number
  estimatedTokens: number
  preview: string
}

interface MessageSnapshot {
  role: string
  charCount: number
  estimatedTokens: number
  cleared: boolean
  truncated: boolean
  compacted: boolean
  toolName?: string
  preview: string
}

interface StepSnapshot {
  stepIndex: number
  inputTokens: number
  outputTokens: number
  messageCount: number
  toolCallCount: number
  microcompactCleared?: number
  compactionCompressed?: number
  messages: MessageSnapshot[]
}

interface ContextSnapshot {
  conversationId: string
  systemPrompt: {
    totalChars: number
    totalEstimatedTokens: number
    pipes: PipeSection[]
  }
  steps: StepSnapshot[]
  totalEstimatedTokens: number
  compactionSummary?: string
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

const CLEARED_PLACEHOLDER = '[tool result cleared]'

// estimateTokensFromChars 统一使用 token-estimator.ts（chars/4 * 1.2 中文安全系数）

function getMessageCharCount(msg: unknown): number {
  if (!msg || typeof msg !== 'object') return 0
  const m = msg as { content?: unknown }
  if (typeof m.content === 'string') return m.content.length
  if (Array.isArray(m.content)) {
    return m.content.reduce((sum: number, part: unknown) => {
      if (!part || typeof part !== 'object') return sum + String(part).length
      const p = part as Record<string, unknown>
      if (p.type === 'text' && typeof p.text === 'string') return sum + p.text.length
      if (p.type === 'tool-result') {
        const output = p.output as { value?: unknown } | undefined
        if (output?.value) return sum + String(output.value).length
        return sum + JSON.stringify(p).length
      }
      return sum + JSON.stringify(p).length
    }, 0)
  }
  return JSON.stringify(m.content ?? '').length
}

function getMessageRole(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return 'unknown'
  return (msg as { role?: string }).role ?? 'unknown'
}

function isClearedMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as { content?: unknown }
  if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>
        if (p.type === 'tool-result' && p.output && typeof p.output === 'object') {
          const output = p.output as { value?: unknown; type?: string }
          if (output.type === 'text' && output.value === CLEARED_PLACEHOLDER) return true
        }
      }
    }
  }
  return false
}

function getToolName(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as { content?: unknown }
  if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>
        if (p.type === 'tool-result' && typeof p.toolName === 'string') return p.toolName
        if (p.type === 'tool-call' && typeof p.toolName === 'string') return p.toolName
      }
    }
  }
  return undefined
}

function getMessagePreview(msg: unknown, maxLen = 120): string {
  if (!msg || typeof msg !== 'object') return ''
  const m = msg as { content?: unknown }
  let text = ''
  if (typeof m.content === 'string') {
    text = m.content
  } else if (Array.isArray(m.content)) {
    const parts: string[] = []
    for (const part of m.content) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
      else if (p.type === 'tool-call') parts.push(`[调用 ${p.toolName}]`)
      else if (p.type === 'tool-result') parts.push(`[结果 ${p.toolName}]`)
      else parts.push(JSON.stringify(p).slice(0, 60))
    }
    text = parts.join(' ')
  }
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

// ─── 从日志中提取上下文快照 ──────────────────────────────────────────────────

function extractContextFromLogs(conversationId: string): ContextSnapshot | null {
  const convDir = path.join(os.homedir(), '.manta-data', 'conversations', conversationId)
  const logPath = path.join(convDir, 'log.ndjson')
  if (!fs.existsSync(logPath)) return null

  const logLines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean)
  if (logLines.length === 0) return null

  const pipes: PipeSection[] = []
  const steps: StepSnapshot[] = []
  let compactionSummary: string | undefined

  for (const line of logLines) {
    try {
      const entry = JSON.parse(line)
      const msg = entry.message ?? ''
      const meta = entry.metadata ?? {}
      const extra = meta.extra ?? entry.details ?? {}

      // 提取 System Prompt Pipe 信息
      if (msg.includes('Prompt Pipe 构建完成') && extra.pipes) {
        const pipeList = extra.pipes as Array<{ name: string; enabled: boolean; charCount: number; estimatedTokens: number }>
        for (const p of pipeList) {
          pipes.push({
            name: p.name,
            enabled: p.enabled,
            charCount: p.charCount,
            estimatedTokens: p.estimatedTokens,
            preview: '',
          })
        }
      }

      // 提取每步 Agent Loop 的消息列表摘要
      if (msg.includes('→ 模型') && extra.messagesPreview) {
        const stepIndex: number = meta.stepIndex ?? steps.length
        // 估算此步的 inputTokens
        const usage = meta.usage ?? {}
        const inputTokens = (usage.inputTokens as number) ?? 0
        const outputTokens = (usage.outputTokens as number) ?? 0

        steps.push({
          stepIndex,
          inputTokens,
          outputTokens,
          messageCount: (extra.messageCount as number) ?? 0,
          toolCallCount: (extra.toolCount as number) ?? 0,
          messages: [], // 稍后从快照文件填充
        })
      }

      // 提取 Microcompact 信息
      if (msg.includes('Microcompact') && msg.includes('清理完成')) {
        const clearedCount = (extra.clearedCount as number) ?? 0
        const lastStep = steps[steps.length - 1]
        if (lastStep) {
          lastStep.microcompactCleared = clearedCount
        }
      }

      // 提取 Compaction 信息
      if (msg.includes('Compaction') && msg.includes('压缩完成')) {
        const compressedCount = (extra.compressedCount as number) ?? 0
        const lastStep = steps[steps.length - 1]
        if (lastStep) {
          lastStep.compactionCompressed = compressedCount
        }
        if (extra.summaryLength) {
          compactionSummary = `压缩了 ${(extra.compressedCount as number) ?? 0} 条消息，摘要 ${extra.summaryLength} 字`
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  // 填充 system prompt preview（从最新的一条 system 日志中提取）
  if (pipes.length > 0) {
    for (const line of logLines) {
      try {
        const entry = JSON.parse(line)
        const meta = entry.metadata ?? {}
        if (meta.systemContent && pipes.some(p => !p.preview)) {
          const fullPrompt = meta.systemContent as string
          let offset = 0
          for (const pipe of pipes) {
            if (!pipe.enabled || pipe.charCount === 0) continue
            pipe.preview = fullPrompt.slice(offset, offset + Math.min(pipe.charCount, 200))
            offset += pipe.charCount + 2 // \n\n separator
          }
          break
        }
      } catch { /* skip */ }
    }
  }

  // 从上下文快照文件填充每个 step 的消息详情
  const snapshots = loadContextSnapshots(conversationId)

  // 将快照转为 MessageSnapshot 的辅助函数
  function snapToMessageSnapshots(snap: CoreContextStepSnapshot): MessageSnapshot[] {
    return snap.messages.map(m => ({
      role: m.role,
      charCount: m.charCount,
      estimatedTokens: m.estimatedTokens,
      cleared: m.cleared,
      truncated: m.truncated,
      compacted: m.compacted,
      toolName: m.toolName,
      preview: m.content.length > 150 ? m.content.slice(0, 150) + '…' : m.content,
    }))
  }

  // 用快照数据填充 steps
  if (snapshots.length > 0) {
    if (steps.length === 0) {
      // 日志中没有步骤信息，直接根据快照构建 steps
      for (const snap of snapshots) {
        steps.push({
          stepIndex: snap.stepIndex,
          inputTokens: 0,
          outputTokens: 0,
          messageCount: snap.messageCount,
          toolCallCount: 0,
          messages: snapToMessageSnapshots(snap),
        })
      }
    } else {
      // 用快照数据填充已有 steps
      for (const step of steps) {
        const matchingSnap = snapshots.find(s => s.stepIndex === step.stepIndex)
        if (matchingSnap) {
          step.messages = snapToMessageSnapshots(matchingSnap)
          step.messageCount = matchingSnap.messageCount
        }
      }
    }
  }

  const totalSystemTokens = pipes.reduce((s, p) => s + p.estimatedTokens, 0)
  const totalStepTokens = steps.reduce((s, step) => s + step.inputTokens + step.outputTokens, 0)

  return {
    conversationId,
    systemPrompt: {
      totalChars: pipes.reduce((s, p) => s + p.charCount, 0),
      totalEstimatedTokens: totalSystemTokens,
      pipes,
    },
    steps,
    totalEstimatedTokens: totalSystemTokens + totalStepTokens,
    compactionSummary,
  }
}

// ─── 从会话消息中重建上下文视图 ──────────────────────────────────────────────

function buildMessageContext(conversationId: string): { messages: MessageSnapshot[]; perTurn: Array<{ turnIndex: number; label: string; messages: MessageSnapshot[] }> } | null {
  const conv = getConversation(conversationId)
  if (!conv) return null

  const allMessages: MessageSnapshot[] = []
  const perTurn: Array<{ turnIndex: number; label: string; messages: MessageSnapshot[] }> = []

  let turnIndex = 0
  let currentTurn: MessageSnapshot[] = []

  for (const msg of conv.messages) {
    const charCount = typeof msg.content === 'string'
      ? msg.content.length
      : JSON.stringify(msg.content ?? '').length
    const estimatedTokens = estimateTokensFromChars(charCount)
    const preview = typeof msg.content === 'string'
      ? (msg.content.length > 120 ? msg.content.slice(0, 120) + '…' : msg.content)
      : '[工具调用]'

    const snapshot: MessageSnapshot = {
      role: msg.role,
      charCount,
      estimatedTokens,
      cleared: false,
      truncated: false,
      compacted: false,
      preview,
    }

    // 检查是否有 toolCalls，提取工具名
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      snapshot.toolName = msg.toolCalls.map(tc => tc.toolName).join(', ')
    }

    if (msg.role === 'user') {
      if (currentTurn.length > 0) {
        perTurn.push({
          turnIndex: turnIndex++,
          label: currentTurn[0].preview.slice(0, 40) || `Turn ${turnIndex}`,
          messages: [...currentTurn],
        })
      }
      currentTurn = [snapshot]
    } else {
      currentTurn.push(snapshot)
    }
    allMessages.push(snapshot)
  }

  // 最后一个 turn
  if (currentTurn.length > 0) {
    perTurn.push({
      turnIndex,
      label: currentTurn[0].preview.slice(0, 40) || `Turn ${turnIndex}`,
      messages: [...currentTurn],
    })
  }

  return { messages: allMessages, perTurn }
}

// ─── 路由处理 ────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const conv = getConversation(id)
    if (!conv) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }

    // 从日志中提取上下文快照
    const logContext = extractContextFromLogs(id)

    // 从会话数据中重建消息上下文
    const messageContext = buildMessageContext(id)

    // 基本会话信息
    const userMsgCount = conv.messages.filter(m => m.role === 'user').length
    const assistantMsgCount = conv.messages.filter(m => m.role === 'assistant').length
    const allToolCalls = conv.messages.flatMap(m => m.toolCalls ?? [])
    const totalInputTokens = conv.messages.reduce((s, m) => s + (m.usage?.inputTokens ?? 0), 0)
    const totalOutputTokens = conv.messages.reduce((s, m) => s + (m.usage?.outputTokens ?? 0), 0)

    return NextResponse.json({
      conversationId: id,
      summary: {
        title: conv.title,
        agentName: conv.agentName,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        userMsgCount,
        assistantMsgCount,
        toolCallCount: allToolCalls.length,
        totalInputTokens,
        totalOutputTokens,
        totalMessages: conv.messages.length,
      },
      systemPrompt: logContext?.systemPrompt ?? { totalChars: 0, totalEstimatedTokens: 0, pipes: [] },
      steps: logContext?.steps ?? [],
      perTurn: messageContext?.perTurn ?? [],
      compactionSummary: logContext?.compactionSummary,
      totalEstimatedTokens: logContext?.totalEstimatedTokens ?? 0,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
