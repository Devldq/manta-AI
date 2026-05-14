/* Agent 执行循环 — 手动实现 while 循环，每步调用 streamText 保持真流式 */
import { streamText, type ModelMessage, stepCountIs } from 'ai'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'
import { conversationTools } from '@/core/conversation/tools'
import { fsTools } from '@/core/conversation/fs-tools'
import { ccTools } from '@/core/conversation/cc-tools'
import { LoopDetector } from './loop-detector'
import type { LoopDetectionResult } from './loop-detector'

/** Token 预算上限（累计输出 token 超过此值则停止） */
const MAX_OUTPUT_TOKENS = 8000

/** 安全兜底步数上限（极高值，仅在循环检测和 token 预算都未触发时生效） */
const SAFETY_MAX_STEPS = 100

const ALL_TOOLS = { ...conversationTools, ...fsTools, ...ccTools }

/** Agent Loop 选项 */
export interface AgentLoopOptions {
  messages: ModelMessage[]
  systemPrompt?: string | null
  abortSignal?: AbortSignal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: any) => Promise<void> | void
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: result.toolCallId,
            toolName,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: result.output as any,
          },
        ],
      } as any)
    }
  }

  return [...messages, ...newMessages]
}

/**
 * 执行 Agent Loop：
 * - 手动 while 循环，每步调一次 streamText(maxSteps=1)
 * - 遍历 fullStream 收集结果 + 转发给客户端
 * - 退出条件：无工具调用 | Token 预算 | 循环检测 | 安全步数兜底 | 用户中断
 */
export async function runAgentLoop({ messages, systemPrompt, abortSignal, onFinish }: AgentLoopOptions) {
  const llmConfig = getLLMConfig()
  const model = await getAISDKModel()

  const loopDetector = new LoopDetector()
  let totalOutputTokens = 0
  const allStepCollects: StepCollect[] = []
  let currentMessages: ModelMessage[] = [...messages]
  let stepIndex = 0
  let warningMessage: string | null = null

  // 创建合并流：将多步的 SSE 事件统一转发给客户端
  const encoder = new TextEncoder()
  const streamChunks: string[] = []  // 收集所有 SSE chunk

  while (true) {
    console.log(`[AgentLoop] Step ${stepIndex + 1}...`)

    // 注入警告消息到 systemPrompt
    const effectiveSystemPrompt = warningMessage
      ? `${systemPrompt ?? ''}\n\n[系统提醒] ${warningMessage}`
      : systemPrompt ?? undefined
    warningMessage = null

    // 每步调一次 streamText，stopWhen=[stepCountIs(1)] 强制单步执行
    const result = streamText({
      model,
      system: effectiveSystemPrompt,
      tools: ALL_TOOLS,
      temperature: llmConfig.temperature ?? 0.7,
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

    // 遍历 fullStream：收集数据 + 转发给客户端
    for await (const chunk of result.fullStream) {
      // 转发 SSE 事件给客户端
      const sseLine = `data: ${JSON.stringify(chunk)}\n\n`
      streamChunks.push(sseLine)

      // 同时收集到 stepCollect
      switch (chunk.type) {
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
          stepCollect.toolResults.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            output: chunk.output,
        // AI SDK v6 不在 fullStream tool-result chunk 中暴露 isError
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // 调用 onFinish 回调
  if (onFinish) {
    const totalUsage = allStepCollects.reduce(
      (acc, step) => ({
        inputTokens: acc.inputTokens + step.usage.inputTokens,
        outputTokens: acc.outputTokens + step.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 }
    )
    const finalText = allStepCollects.map((s) => s.text).join('')

    // 构造与 AI SDK OnFinishEvent 兼容的结构
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

  // 返回真流式响应（合并所有步骤的 SSE 事件）
  const mergedStream = new ReadableStream({
    start(controller) {
      for (const chunk of streamChunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return new Response(mergedStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}