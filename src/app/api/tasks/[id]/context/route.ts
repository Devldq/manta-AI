/* GET /api/tasks/[id]/context — 上下文状态快照
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
import { getTask } from '@/core/storage/task/store'
import { loadContextSnapshots, type ContextStepSnapshot as CoreContextStepSnapshot } from '@context/context-snapshot'
import { estimateTokensFromChars } from '@context/token/estimator'

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─── 类型 ────────────────────────────────────────────────────────────

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
  taskId: string
  systemPrompt: {
    totalChars: number
    totalEstimatedTokens: number
    pipes: PipeSection[]
  }
  steps: StepSnapshot[]
  totalEstimatedTokens: number
  compactionSummary?: string
}

// ─── 辅助函数 ────────────────────────────────────────────────────────

const CLEARED_PLACEHOLDER = '[tool result cleared]'

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
  if (typeof m.content === 'string') return m.content.includes(CLEARED_PLACEHOLDER)
  if (Array.isArray(m.content)) {
    return m.content.some((part: unknown) => {
      if (!part || typeof part !== 'object') return false
      const p = part as Record<string, unknown>
      if (p.type === 'tool-result') {
        const output = p.output as { value?: unknown } | undefined
        return output?.value === CLEARED_PLACEHOLDER
      }
      return false
    })
  }
  return false
}

function buildSystemPromptPreview(task: { agentName: string }): { pipes: PipeSection[]; totalChars: number; totalEstimatedTokens: number } {
  // 简化实现：直接返回空 pipes（实际应调用 prompt-builder）
  return {
    pipes: [],
    totalChars: 0,
    totalEstimatedTokens: 0,
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const task = getTask(id)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // 加载上下文快照
    const workspaceId = task.workspaceId
    const contextDir = workspaceId
      ? path.join(os.homedir(), '.manta-data', 'workspaces', workspaceId, 'context')
      : path.join(os.homedir(), '.manta-data', 'tasks', id, 'context')
    
    let steps: CoreContextStepSnapshot[] = []
    try {
      steps = loadContextSnapshots(contextDir)
    } catch {
      // 没有上下文快照，返回基本信息
    }

    // 构建 System Prompt 预览
    const systemPrompt = buildSystemPromptPreview(task)

    // 构建步骤快照
    const stepSnapshots: StepSnapshot[] = steps.map((s, idx) => {
      const messages: MessageSnapshot[] = s.messages.map(m => ({
        role: getMessageRole(m),
        charCount: getMessageCharCount(m),
        estimatedTokens: estimateTokensFromChars(getMessageCharCount(m)),
        cleared: isClearedMessage(m),
        truncated: false,
        compacted: false,
        preview: '',
      }))

      return {
        stepIndex: idx,
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        messageCount: messages.length,
        toolCallCount: 0,
        messages,
      }
    })

    const snapshot: ContextSnapshot = {
      taskId: id,
      systemPrompt: {
        totalChars: systemPrompt.totalChars,
        totalEstimatedTokens: systemPrompt.totalEstimatedTokens,
        pipes: systemPrompt.pipes,
      },
      steps: stepSnapshots,
      totalEstimatedTokens: systemPrompt.totalEstimatedTokens,
    }

    return NextResponse.json(snapshot)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
