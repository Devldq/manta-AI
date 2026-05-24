/* Agent 执行循环 — 手动实现 while 循环，每步调用 streamText 保持真流式 */
import { streamText, type ModelMessage, stepCountIs } from 'ai'
import { transformChunk } from './stream-transformer'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'
import { getAgentTools } from '@/core/tool-registry/mcp-setup'
import { LoopDetector } from './loop-detector'
import type { LoopDetectionResult } from './loop-detector'
import { formatAIError, formatErrorForSSE } from './error-formatter'
import { logger } from '@/core/log'

/** Token 预算默认值 */
const DEFAULT_MAX_OUTPUT_TOKENS = 1_000_000

/** 安全兜底步数默认值 */
const DEFAULT_MAX_STEPS = 200

/** Agent Loop 选项 */
export interface AgentLoopOptions {
  messages: ModelMessage[]
  systemPrompt?: string | null
  /** 用户输入的原始提示词（用于日志记录） */
  prompt?: string
  abortSignal?: AbortSignal
  conversationId?: string
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
 * @param maxOutputTokens Token 预算上限，0 = 不限
 * @param maxSteps 步数上限，0 = 不限
 */
function decideStop(
  stepCollect: StepCollect,
  loopDetector: LoopDetector,
  totalOutputTokens: number,
  stepIndex: number,
  maxOutputTokens: number,
  maxSteps: number,
): StopDecision {
  // 1. 安全兜底步数上限（0 = 不限）
  if (maxSteps > 0 && stepIndex >= maxSteps) {
    return { shouldStop: true, reason: `safety-max-steps:${maxSteps}` }
  }

  // 2. Token 预算超限（0 = 不限）
  if (maxOutputTokens > 0 && totalOutputTokens >= maxOutputTokens) {
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
  stepCollect: StepCollect,
  conversationId?: string,
  stepIndex?: number,
  messageId?: string,
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

    // 防御：为缺少结果的 tool-call 补充错误结果，避免 AI SDK 报 "Tool result is missing"
    const resultCallIds = new Set(stepCollect.toolResults.map((r) => r.toolCallId))
    for (const call of stepCollect.toolCalls) {
      if (!resultCallIds.has(call.toolCallId)) {
        logger.warn(`[AgentLoop] 工具 ${call.toolName} (${call.toolCallId}) 缺少结果，补充兜底错误`, {
          ...baseMeta,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          stepIndex,
        }, ['agent', 'loop', 'tool-missing'])
        newMessages.push({
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              output: { type: 'error-text', value: '工具执行超时或未返回结果' },
            },
          ],
        } as ModelMessage)
      }
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
export async function runAgentLoop({ messages, systemPrompt, prompt, abortSignal, conversationId, onFinish, onError }: AgentLoopOptions) {
  const llmConfig = getLLMConfig()
  const model = await getAISDKModel()

  // 从配置读取限制，0 = 不限，未设置则用默认值
  const maxOutputTokens = llmConfig.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const maxSteps = llmConfig.maxSteps ?? DEFAULT_MAX_STEPS

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

    // 基础日志元数据（所有本 loop 日志共享）
    const baseMeta = { messageId, conversationId, prompt }

    // 获取共享 ToolRegistry（含 MCP 工具，首次调用时初始化 MCP 连接）
    const allTools = await getAgentTools()

    try {
      // 发送统一的 start 事件（只发一次，整个 loop 共享 messageId）
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', messageId })}\n\n`))

      while (true) {
        logger.info(`[AgentLoop] 第 ${stepIndex + 1} 轮开始`, {
          ...baseMeta,
          stepIndex,
          messageCount: currentMessages.length,
        }, ['agent', 'loop', 'step-start'])

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
              logger.info(`[AgentLoop] 工具调用开始: ${chunk.toolName}`, {
                ...baseMeta,
                stepIndex,
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              }, ['agent', 'loop', 'tool-call'])
              break
            case 'tool-result':
              // AI SDK v6: tool-result chunk 使用 output 字段存储执行结果（不是 result）
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toolResult = (chunk as any).output
              const toolResultIsError = (chunk as any).isError ?? false
              stepCollect.toolResults.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                output: toolResult,
                isError: toolResultIsError,
              })
              logger.toolCall(
                chunk.toolName,
                chunk.toolCallId,
                stepCollect.toolCalls.find(c => c.toolCallId === chunk.toolCallId)?.input ?? null,
                toolResult,
                toolResultIsError,
                toolResultIsError ? String(toolResult ?? '') : undefined,
                { ...baseMeta, stepIndex }
              )
              break
            case 'tool-error':
              // 工具执行抛出异常时，AI SDK 发出 tool-error chunk（而非 tool-result）
              // 必须收集此 chunk，否则下次 streamText 会因为缺少 tool-result 而报错
              logger.toolCall(
                chunk.toolName,
                chunk.toolCallId,
                stepCollect.toolCalls.find(c => c.toolCallId === chunk.toolCallId)?.input ?? null,
                chunk.error ?? '工具执行失败',
                true,
                String(chunk.error ?? ''),
                { ...baseMeta, stepIndex }
              )
              stepCollect.toolResults.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                output: chunk.error ?? '工具执行失败',
                isError: true,
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

        // 记录步骤完成
        allStepCollects.push(stepCollect)
        logger.agentLoop(
          stepIndex,
          currentMessages.length,
          stepCollect.toolCalls.length,
          totalOutputTokens,
          {
            ...baseMeta,
            finishReason: stepCollect.finishReason,
            toolCallNames: stepCollect.toolCalls.map(c => c.toolName),
            hasText: !!stepCollect.text,
          }
        )

        // 判断退出条件（一次调用，包含 warning 检测）
        const decision = decideStop(stepCollect, loopDetector, totalOutputTokens, stepIndex, maxOutputTokens, maxSteps)
        if (decision.shouldStop) {
          logger.info(`[AgentLoop] 循环结束: ${decision.reason}`, {
            ...baseMeta,
            stepIndex,
            reason: decision.reason,
            totalOutputTokens,
            totalSteps: stepIndex + 1,
          }, ['agent', 'loop', 'stop'])
          break
        }
        if (decision.warningToInject) {
          warningMessage = decision.warningToInject
          logger.warn(`[LoopDetector] 循环警告: ${warningMessage}`, {
            ...baseMeta,
            stepIndex,
            warning: warningMessage,
          }, ['agent', 'loop', 'warning'])
        }

        // 将步骤结果追加到消息列表
        currentMessages = appendStepToMessages(currentMessages, stepCollect, conversationId, stepIndex, messageId)
        stepIndex++
      }

      // Agent Loop 整体完成摘要日志
      const totalUsage = allStepCollects.reduce(
        (acc, step) => ({
          inputTokens: acc.inputTokens + step.usage.inputTokens,
          outputTokens: acc.outputTokens + step.usage.outputTokens,
        }),
        { inputTokens: 0, outputTokens: 0 }
      )
      logger.info(`[AgentLoop] 全部完成: ${allStepCollects.length} 轮, ${allStepCollects.reduce((n, s) => n + s.toolCalls.length, 0)} 次工具调用`, {
        ...baseMeta,
        totalSteps: allStepCollects.length,
        totalToolCalls: allStepCollects.reduce((n, s) => n + s.toolCalls.length, 0),
        totalInputTokens: totalUsage.inputTokens,
        totalOutputTokens: totalUsage.outputTokens,
        finishReason: allStepCollects[allStepCollects.length - 1]?.finishReason ?? 'stop',
      }, ['agent', 'loop', 'summary'])

      // 调用 onFinish 回调（流结束后持久化消息）
      if (onFinish) {
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
      logger.error('[AgentLoop] 执行异常:', err, {
        ...baseMeta,
        stepIndex,
      }, ['agent', 'loop', 'error'])
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