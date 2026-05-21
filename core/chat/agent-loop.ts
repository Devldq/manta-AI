/* Agent 执行循环 — 手动实现 while 循环，每步调用 streamText 保持真流式 */
import { streamText, type ModelMessage, stepCountIs } from 'ai'
import { transformChunk } from './stream-transformer'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'
import { getAgentTools } from '@/core/tool-registry/mcp-setup'
import { LoopDetector } from './loop-detector'
import type { LoopDetectionResult } from './loop-detector'
import { formatAIError, formatErrorForSSE } from './error-formatter'

/** Token 预算上限（累计输出 token 超过此值则停止） */
const MAX_OUTPUT_TOKENS = 8000

/** 安全兜底步数上限（极高值，仅在循环检测和 token 预算都未触发时生效） */
const SAFETY_MAX_STEPS = 100

/** Agent Loop 选项 */
export interface AgentLoopOptions {
  messages: ModelMessage[]
  systemPrompt?: string | null
  abortSignal?: AbortSignal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: any) => Promise<void> | void
  /** 错误时回调，用于持久化错误信息到对话历史 */
  onError?: (errorText: string) => Promise<void> | void
}

/** 单步收集的结果 */
interface StepCollect {
  text: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any[]
  toolResults: { toolCallId: string; toolName: string; output: unknown; isError?: boolean }[]
  usage: { inputTokens: number; outputTokens: number }
  finishReason: string
}

/** 退出条件判断结果 */
interface StopDecision {
  shouldStop: boolean
  reason: string
  warningToInject?: string
}

/**
 * 判断是否应该退出循环（合并所有检测逻辑，避免重复调用 detect）
 */
function decideStop(
  stepCollect: StepCollect,
  loopDetector: LoopDetector,
  totalOutputTokens: number,
  stepIndex: number
): StopDecision {
  // 1. 安全兜底步数上限
  if (stepIndex >= SAFETY_MAX_STEPS) {
    return { shouldStop: true, reason: `safety-max-steps:${SAFETY_MAX_STEPS}` }
  }

  // 2. Token 预算超限
  if (totalOutputTokens >= MAX_OUTPUT_TOKENS) {
    return { shouldStop: true, reason: 'token-budget' }
  }

  // 3. 循环检测（一次调用，同时处理所有级别）
  const loopResult: LoopDetectionResult = loopDetector.detect()
  if (loopResult.severity === 'circuit-breaker') {
    return { shouldStop: true, reason: `circuit-breaker:${loopResult.type}` }
  }
  if (loopResult.severity === 'critical') {
    return { shouldStop: true, reason: `critical:${loopResult.type}` }
  }
  if (loopResult.severity === 'warning' && !loopDetector.hasInjectedWarning()) {
    loopDetector.markWarningInjected()
    return {
      shouldStop: false,
      reason: '',
      warningToInject: loopResult.message ?? '检测到可能的循环行为，请尝试其他方法。',
    }
  }

  // 4. 模型不再调用工具 → 自然结束
  if (stepCollect.toolCalls.length === 0) {
    return { shouldStop: true, reason: 'no-tool-calls' }
  }

  return { shouldStop: false, reason: '' }
}

/**
 * 将工具输出转换为 AI SDK v6 outputSchema 格式
 * outputSchema 是 discriminatedUnion，不接受原始值
 */
function formatToolOutput(output: unknown, isError: boolean): { type: string; value: unknown } {
  if (isError) {
    return { type: 'error-text', value: String(output ?? 'Unknown error') }
  }
  // JSON 对象 → json 格式，字符串 → text 格式
  if (typeof output === 'object' && output !== null) {
    return { type: 'json', value: output }
  }
  return { type: 'text', value: String(output ?? '') }
}

/**
 * 将步骤结果追加到消息列表（toolName 从 toolCalls 中查找）
 */
function appendStepToMessages(
  messages: ModelMessage[],
  stepCollect: StepCollect
): ModelMessage[] {
  const newMessages: ModelMessage[] = []

  // 添加 assistant 的文本回复（如果有）
  if (stepCollect.text) {
    newMessages.push({
      role: 'assistant',
      content: [{ type: 'text', text: stepCollect.text }],
    } as ModelMessage)
  }

  // 添加 assistant 的工具调用
  if (stepCollect.toolCalls.length > 0) {
    newMessages.push({
      role: 'assistant',
      content: stepCollect.toolCalls.map((call) => ({
        type: 'tool-call' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
    } as ModelMessage)

    // 添加工具结果（toolName 从 toolCalls 中查找对应值）
    for (const result of stepCollect.toolResults) {
      const matchingCall = stepCollect.toolCalls.find(
        (c) => c.toolCallId === result.toolCallId
      )
      const toolName = matchingCall?.toolName ?? result.toolName

      newMessages.push({
        role: 'tool' as const,
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: result.toolCallId,
            toolName,
            output: formatToolOutput(result.output, result.isError ?? false),
          },
        ],
      } as ModelMessage)
    }
  }

  return [...messages, ...newMessages]
}

/**
 * 执行 Agent Loop（真流式）：
 * - 先创建 ReadableStream + Response 并立即返回
 * - 在后台异步循环中逐个 enqueue chunk 到 controller
 * - 退出条件：无工具调用 | Token 预算 | 循环检测 | 安全步数兜底 | 用户中断
 */
export async function runAgentLoop({ messages, systemPrompt, abortSignal, onFinish, onError }: AgentLoopOptions) {
  const llmConfig = getLLMConfig()
  const model = await getAISDKModel()

  const encoder = new TextEncoder()
  let streamController!: ReadableStreamDefaultController<Uint8Array>

  // 1. 先创建 ReadableStream，立即返回 Response（真流式）
  const mergedStream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
    },
  })

  // 2. 在后台异步执行 agent loop，边产生边 enqueue
  ;(async () => {
    const loopDetector = new LoopDetector()
    let totalOutputTokens = 0
    const allStepCollects: StepCollect[] = []
    let currentMessages: ModelMessage[] = [...messages]
    let stepIndex = 0
    let warningMessage: string | null = null

    // 生成统一的 messageId，整个 agent loop 共享（确保前端合并为一个消息气泡）
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // 获取共享 ToolRegistry（含 MCP 工具，首次调用时初始化 MCP 连接）
    const allTools = await getAgentTools()

    try {
      // 发送统一的 start 事件（只发一次，整个 loop 共享 messageId）
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', messageId })}\n\n`))

      while (true) {
        console.log(`[AgentLoop] Step ${stepIndex + 1}...`)

        // 注入警告消息到 systemPrompt
        const effectiveSystemPrompt = warningMessage
          ? `${systemPrompt ?? ''}\n\n[系统提醒] ${warningMessage}`
          : systemPrompt ?? undefined
        warningMessage = null

        // 每步调一次 streamText，stopWhen=[stepCountIs(1)] 强制单步执行
        const effectiveTemperature = llmConfig.temperature ?? 0.7
        const result = streamText({
          model,
          system: effectiveSystemPrompt,
          tools: allTools,
          temperature: effectiveTemperature,
          messages: currentMessages,
          abortSignal,
          stopWhen: stepCountIs(1),
        })

        // 收集本步结果
        const stepCollect: StepCollect = {
          text: '',
          toolCalls: [],
          toolResults: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: '',
        }

        // 遍历 fullStream：收集数据 + 逐个 enqueue 到流式 controller
        for await (const chunk of result.fullStream) {
          // 将 fullStream chunk 转换为 UIMessageChunk 格式并立即 enqueue
          const transformed = transformChunk(chunk as { type: string; [key: string]: unknown })
          if (transformed) {
            streamController.enqueue(encoder.encode(`data: ${JSON.stringify(transformed)}\n\n`))
          }

          // 同时收集到 stepCollect
          switch (chunk.type) {
            case 'error':
              // AI SDK v5+ 通过 fullStream 发射 error chunk，而不是抛异常
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const errorFromChunk = (chunk as any).error ?? chunk
              const errorInfo = formatAIError(errorFromChunk)
              const friendlyMessage = formatErrorForSSE(errorInfo)
              const errorChunk = { type: 'error', errorText: friendlyMessage }
              try {
                streamController.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
              } catch { /* ignore */ }
              // 直接关闭流并退出，不 throw（避免外层 catch 重复处理）
              try { streamController.close() } catch { /* ignore */ }
              // 保存错误信息到对话历史
              if (onError) {
                await onError(friendlyMessage)
              }
              return

            case 'text-delta':
              stepCollect.text += chunk.text
              break
            case 'tool-call':
              stepCollect.toolCalls.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              })
              break
            case 'tool-result':
              // AI SDK v6: tool-result chunk 使用 output 字段存储执行结果（不是 result）
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toolResult = (chunk as any).output
              stepCollect.toolResults.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                output: toolResult,
                isError: (chunk as any).isError ?? false,
              })
              break
            case 'finish':
              stepCollect.finishReason = chunk.finishReason
              if (chunk.totalUsage) {
                stepCollect.usage = {
                  inputTokens: chunk.totalUsage.inputTokens ?? 0,
                  outputTokens: chunk.totalUsage.outputTokens ?? 0,
                }
              }
              break
          }
        }

        // 记录工具调用到循环检测器
        for (const call of stepCollect.toolCalls) {
          const toolResult = stepCollect.toolResults.find(
            (r) => r.toolCallId === call.toolCallId
          )
          loopDetector.recordCall(call.toolName, call.input, toolResult?.output ?? null, stepIndex)
        }

        // 更新累计 token
        totalOutputTokens += stepCollect.usage.outputTokens

        // 记录步骤
        allStepCollects.push(stepCollect)

        // 判断退出条件（一次调用，包含 warning 检测）
        const decision = decideStop(stepCollect, loopDetector, totalOutputTokens, stepIndex)
        if (decision.shouldStop) {
          console.log(`[AgentLoop] Stopping: ${decision.reason}`)
          break
        }
        if (decision.warningToInject) {
          warningMessage = decision.warningToInject
          console.warn(`[LoopDetector] Warning：${warningMessage}`)
        }

        // 将步骤结果追加到消息列表
        currentMessages = appendStepToMessages(currentMessages, stepCollect)
        stepIndex++
      }

      // 调用 onFinish 回调（流结束后持久化消息）
      if (onFinish) {
        const totalUsage = allStepCollects.reduce(
          (acc, step) => ({
            inputTokens: acc.inputTokens + step.usage.inputTokens,
            outputTokens: acc.outputTokens + step.usage.outputTokens,
          }),
          { inputTokens: 0, outputTokens: 0 }
        )
        const finalText = allStepCollects.map((s) => s.text).join('')

        const stepsForCallback = allStepCollects.map((s) => ({
          finishReason: s.finishReason,
          toolCalls: s.toolCalls,
          toolResults: s.toolResults,
          usage: s.usage,
        }))

        await onFinish({
          text: finalText,
          steps: stepsForCallback,
          totalUsage,
          usage: totalUsage,
          finishReason: allStepCollects[allStepCollects.length - 1]?.finishReason ?? 'stop',
        })
      }

      // 流结束，关闭 controller
      streamController.close()
    } catch (err) {
      console.error('[AgentLoop] Error:', err)
      // 将技术错误转换为用户友好的提示
      const errorInfo = formatAIError(err)
      const friendlyMessage = formatErrorForSSE(errorInfo)
      const errorChunk = { type: 'error', errorText: friendlyMessage }
      try {
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
      } catch { /* controller 可能已关闭 */ }
      try { streamController.close() } catch { /* 忽略 */ }
      // 保存错误信息到对话历史
      if (onError) {
        await onError(friendlyMessage)
      }
    }
  })()

  // 3. 立即返回 Response（流数据将在后台异步填充）
  return new Response(mergedStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}