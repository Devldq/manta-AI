/* Agent 执行循环 — 手动实现 while 循环，每步调用 streamText 保持真流式 */
import { generateText, streamText, type ModelMessage, stepCountIs } from 'ai'
import { transformChunk } from './stream-transformer'
import { getAISDKModel } from '@llm/ai-sdk-provider'
import { getLLMConfig } from '@llm/config-store'
import { LoopDetector } from '@context/loop-detector'
import type { LoopDetectionResult } from '@context/loop-detector'
import { formatAIError, formatErrorForSSE } from './error-formatter'
import { applyMicrocompactWithLogging } from '@context/compaction/microcompact'
import { compactMessages } from '@context/compaction/llm-compaction'
import { clearSnapshots, recordContextSnapshot } from '@context/context-snapshot'
import { createTokenTracker, type TokenTracker } from '@context/token/tracker'
import { truncateToolResultsWithLogging } from '@context/compaction/truncate'
import { ttlPruneWithLogging, MessageTimestampTracker } from '@context/compaction/ttl-prune'
import {
  buildCacheProviderOptions,
  CacheStatsAccumulator,
  extractCacheHit,
  logCacheStrategy,
} from '@context/prompt-cache'
import { logger } from '@observability/log'
import { recordTurn } from '@observability/metrics'
import type { TurnMetrics, StepMetrics } from '@observability/metrics'
// 使用共享安全上下文模块（解决 tsx 模块解析问题）
import { runWithSecurityContext, type SecurityContext } from '../security-context'
import { findWaitingForInputError } from '@manta/task-runtime'
import { guardStreamResultPromises } from './stream-result-guards.js'
import {
  AgentRuntimeHooks,
  runWithAgentRuntimeHooks,
  type AgentRuntimeExtension,
} from './runtime-hooks'
import {
  getPublicToolReason,
  matchesUserLanguage,
  normalizePublicToolReason,
  setPublicToolReason,
  withoutPublicToolReason,
} from '@tools/public-reason'
import type { AgentRunContextSnapshot } from './agent-run-context'

/** Token 预算默认值 */
const DEFAULT_MAX_OUTPUT_TOKENS = 1_000_000

/** 安全兜底步数默认值 */
const DEFAULT_MAX_STEPS = 200

/** Agent Loop 选项 */
export interface AgentLoopOptions {
  messages: ModelMessage[]
  /** 当前 Conversation 冻结的前五层上下文；Loop 内仅 Messages 持续变化。 */
  runContext: AgentRunContextSnapshot
  /** 当前用户回合的 Intent/Plan，作为第六层动态系统消息注入。 */
  runInstruction?: string
  /** 用户输入的原始提示词（用于日志记录） */
  prompt?: string
  /** 统一的消息ID（整轮 loop 共享，由上层调用方提前生成） */
  messageId?: string
  /** 专用的 AbortSignal（来自 LoopRegistry，仅用户点击停止时触发，不与 HTTP 请求生命周期绑定） */
  abortSignal?: AbortSignal
  conversationId?: string
  /** 安全上下文（用于路径校验、命令校验等安全检查） */
  securityContext?: SecurityContext
  /** 每个 SSE chunk 的输出回调（写入 LoopRegistry，而非直接写入 HTTP stream） */
  onChunk: (data: string) => void
  /** 循环结束后回调 */
  onDone: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: any) => Promise<void> | void
  /** 错误时回调，用于持久化错误信息到对话历史 */
  onError?: (errorText: string) => Promise<void> | void
  /** Last fully committed model/tool step for durable Job recovery. */
  resumeState?: AgentLoopResumeState
  /** Persist only after tool results have been appended to the next prompt. */
  onStepCommitted?: (state: AgentLoopResumeState) => Promise<void> | void
  /** Per-run observers; global extensions registered in runtime-hooks are included automatically. */
  runtimeExtensions?: AgentRuntimeExtension[]
  /** Startup timing observer used before the normal runtime event stream begins. */
  onStartupPhase?: (phase: string) => Promise<void> | void
  /** Durable executors must observe failures so TaskRuntime cannot mark a failed loop as succeeded. */
  throwOnError?: boolean
  agentName?: string
}

/** 单步 token 用量（含缓存明细） */
export interface StepUsage {
  inputTokens: number
  outputTokens: number
  /** 缓存命中读取的 token 数（节省的费用） */
  cacheReadTokens?: number
  /** 缓存写入的 token 数 */
  cacheWriteTokens?: number
  /** 非缓存输入 token 数 */
  noCacheTokens?: number
}

/** 单步收集的结果 */
export interface StepCollect {
  text: string
  /** 面向用户的执行进度摘要；不包含模型的隐藏推理。 */
  publicProgressText?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolCalls: any[]
  toolResults: { toolCallId: string; toolName: string; output: unknown; isError?: boolean }[]
  usage: StepUsage
  finishReason: string
  /** 本步的缓存命中统计（来自 providerMetadata） */
  cacheHitStats?: { cachedPromptTokens: number; hitRate: number }
}

export interface AgentLoopResumeState {
  messages: ModelMessage[]
  steps: StepCollect[]
  nextStepIndex: number
}

/** 退出条件判断结果 */
interface StopDecision {
  shouldStop: boolean
  reason: string
  warningToInject?: string
}

export type BlankFinalResponseAction = 'not-blank' | 'retry' | 'fail'

/**
 * A provider may finish a step without tool calls but only return whitespace.
 * Such a step is not a valid assistant answer: retry synthesis once, then fail
 * the turn instead of persisting a blank message as a successful result.
 */
export function decideBlankFinalResponse(
  text: string,
  toolCallCount: number,
  retryCount: number,
): BlankFinalResponseAction {
  if (toolCallCount > 0 || text.trim().length > 0) return 'not-blank'
  return retryCount === 0 ? 'retry' : 'fail'
}

export function needsFinalResponseSynthesis(text: string, toolCallCount: number): boolean {
  return toolCallCount > 0 || text.trim().length === 0
}

/**
 * 检测模型输出是否包含"工具使用意图"但实际没有调用工具（空谈不执行）。
 *
 * **只匹配明确的意图声明**，要求文本中包含动作短语（"让我查看"、"我来搜索"等）。
 * 不匹配常见名词（文件、目录、代码等），避免把已完成回答中的措辞误判为空谈。
 *
 * 例如：
 * - "我来看看源码目录结构" → 空谈（只说不做）
 * - "需要查看 src 目录下的具体文件吗？" → 不是空谈（这是回答的一部分）
 */
const EMPTY_INTENT_ACTION_PATTERN = /(?:让我|我来|我需要|我将|我要|让我来)\s*(?:看看?|查看|读[读取]|检查|找一下?|搜[搜索]|了解|探索|look|check|read|examine|inspect|investigate|search|find|explore)/i
const EMPTY_INTENT_EN_PATTERN = /(?:let me|I'?ll|I will|I need to|I'm going to)\s+(?:look|check|read|examine|inspect|investigate|search|find|explore|grep|browse)/i

function detectEmptyIntent(text: string): boolean {
  if (!text || text.length < 10) return false

  // 如果文本包含代码块、列表、或表格 → 大概率是完整回答，不是空谈
  if (/```|^[-*]\s|^\d+\.\s|^\|/m.test(text)) return false

  return EMPTY_INTENT_ACTION_PATTERN.test(text) || EMPTY_INTENT_EN_PATTERN.test(text)
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
  blankFinalResponseRetries: number,
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
  if (loopResult.severity === 'critical' && !loopDetector.hasInjectedCritical()) {
    loopDetector.markCriticalInjected()
    return {
      shouldStop: false,
      reason: '',
      warningToInject: `[严重警告] ${loopResult.message ?? '检测到严重循环行为，你已陷入重复模式。'} 请立即停止当前策略，换一种完全不同的方法，或向用户说明你遇到的问题。`,
    }
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
    // 4a. 空谈检测：模型说了要查/看/读但没有实际调用工具 → 注入提醒，给一次补救机会
    if (detectEmptyIntent(stepCollect.text) && stepIndex < 10) {
      return {
        shouldStop: false,
        reason: 'empty-intent',
        warningToInject: `[执行提醒] 你刚才表示要查看/读取/搜索某些内容（如源码、文件、目录），但没有实际调用工具。请立即使用适当的工具（read_file、search_file、list_dir 等）来完成你说的操作，不要只用文字描述。`,
      }
    }

    const blankFinalAction = decideBlankFinalResponse(
      stepCollect.text,
      stepCollect.toolCalls.length,
      blankFinalResponseRetries,
    )
    if (blankFinalAction === 'retry') {
      return {
        shouldStop: false,
        reason: 'blank-final-response-retry',
        warningToInject: '[收尾要求] 工具调查已经完成。现在必须基于已有结果直接输出完整最终答复，不要再调用工具。',
      }
    }
    if (blankFinalAction === 'fail') {
      return { shouldStop: true, reason: 'blank-final-response-failed' }
    }
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
  if (stepCollect.text.trim()) {
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
          conversationId,
          messageId,
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
 * 执行 Agent Loop（真流式，与 HTTP 连接完全解耦）：
 * - 通过 onChunk 回调输出 SSE 事件（由 LoopRegistry 广播给所有订阅者）
 * - 通过 onDone 回调通知循环结束
 * - 退出条件：无工具调用 | Token 预算 | 循环检测 | 安全步数兜底 | 用户停止
 * - 不创建 ReadableStream 或 Response，不感知 HTTP 连接状态
 */
export async function runAgentLoop({ messages, runContext, runInstruction, prompt, messageId: incomingMessageId, abortSignal, conversationId, securityContext, onChunk, onDone, onFinish, onError, resumeState, onStepCommitted, runtimeExtensions, onStartupPhase, throwOnError = false, agentName }: AgentLoopOptions) {
  const llmConfig = getLLMConfig()
  await onStartupPhase?.('model.create.started')
  const model = await getAISDKModel()
  await onStartupPhase?.('model.create.completed')
  const messageId = incomingMessageId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const runtimeHooks = new AgentRuntimeHooks({
    runId: securityContext?.jobId ?? messageId,
    conversationId,
    messageId,
    taskId: securityContext?.taskId,
    workspaceId: securityContext?.workspaceId,
    jobId: securityContext?.jobId,
    agentName,
  }, runtimeExtensions, ({ extensionName, eventType, error }) => {
    logger.warn(`[AgentRuntime] 扩展 ${extensionName} 处理 ${eventType} 失败`, {
      conversationId,
      messageId,
      extra: { error: error instanceof Error ? error.message : String(error) },
    }, ['agent', 'runtime', 'extension-error'])
  })

  // 从配置读取限制，0 = 不限，未设置则用默认值
  const maxOutputTokens = llmConfig.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const maxSteps = llmConfig.maxSteps ?? DEFAULT_MAX_STEPS

    // Microcompact 配置：默认启用，可通过 LLM 配置关闭
    const microcompactEnabled = llmConfig.microcompact !== false
    // Compaction 配置：默认启用，可通过 LLM 配置关闭
    const compactionEnabled = llmConfig.compaction !== false
    // TTL Prune 配置：默认启用，可通过 LLM 配置关闭
    const ttlPruneEnabled = llmConfig.ttlPrune !== false
    // Prompt Cache 配置：默认启用，可通过 LLM 配置关闭
    const promptCacheEnabled = llmConfig.promptCache !== false

    // ── Prompt Cache：构建 providerOptions ──
    const cacheProviderOptions = promptCacheEnabled
      ? buildCacheProviderOptions(llmConfig, conversationId)
      : undefined
    const cacheAccumulator = new CacheStatsAccumulator()

    // 记录 cache 策略（首次 loop 启动时）
    if (promptCacheEnabled) {
      logCacheStrategy(llmConfig, conversationId)
    }

  // 后台异步执行 agent loop，边产生边通过 onChunk 输出
  const executeLoop = async () => {
    const loopDetector = new LoopDetector()
    let totalOutputTokens = (resumeState?.steps ?? []).reduce((total, step) => total + step.usage.outputTokens, 0)
    const allStepCollects: StepCollect[] = [...(resumeState?.steps ?? [])]
    let currentMessages: ModelMessage[] = [...(resumeState?.messages ?? messages)]
    let stepIndex = resumeState?.nextStepIndex ?? 0
    let warningMessage: string | null = null
    let blankFinalResponseRetries = 0
    let forcingFinalResponse = false

    // ── 消息时间戳跟踪器（供 TTL 修剪使用） ──
    const timestampTracker = new MessageTimestampTracker()
    // 记录初始消息的时间戳
    if (currentMessages.length > 0) {
      timestampTracker.recordNewMessages(0, currentMessages.length)
    }

    // ── TokenTracker：精确基准 + 粗估增量 ──
    const tokenTracker: TokenTracker = createTokenTracker(currentMessages)

    // 基础日志元数据（所有本 loop 日志共享）
    const baseMeta = { messageId, conversationId, workspaceId: securityContext?.workspaceId }

    // ── 性能计时 ──
    const turnStartTime = performance.now()
    let ttftMs = 0
    let ttftMeasured = false
    let loopDetectionCount = 0
    let suspendedForInput = false
    let doneNotified = false

    const notifyDone = () => {
      if (doneNotified) return
      doneNotified = true
      onDone()
    }

    // 辅助函数：发送 SSE 行到 onChunk
    function sendChunk(obj: unknown) {
      onChunk(`data: ${JSON.stringify(obj)}\n\n`)
    }

    try {
      await runtimeHooks.emit('loop.started', {
        resumed: !!resumeState,
        messageCount: currentMessages.length,
        model: llmConfig.model,
        provider: llmConfig.provider,
        maxSteps,
        maxOutputTokens,
      })
      // 不再发送 start 事件 — AI SDK UIMessageChunk schema 不包含此类型
      // 循环开始时直接进入 while，由 AI SDK 自身的 text-start 事件触发消息创建

      // 清空旧上下文快照（每次新 loop 重新记录）
      if (conversationId) {
        clearSnapshots(conversationId)
      }

      while (true) {
        // 检查是否被用户停止
        if (abortSignal?.aborted) {
          await runtimeHooks.emit('loop.aborted', { reason: 'abort-signal', stepIndex })
          notifyDone()
          return
        }

        // 前五层始终使用 Conversation 首次执行时建立的固定快照。
        // 临时运行时提醒进入第六层 Messages，不修改固定的 System Prompt。
        const runtimeWarning = warningMessage
        warningMessage = null
        const dynamicSystemMessages: ModelMessage[] = []
        if (runInstruction) {
          dynamicSystemMessages.push({ role: 'system', content: runInstruction })
        }
        if (runtimeWarning) {
          dynamicSystemMessages.push({
            role: 'system',
            content: `[运行时提醒] ${runtimeWarning}`,
          })
        }
        const stepMessages = dynamicSystemMessages.length > 0
          ? [...dynamicSystemMessages, ...currentMessages]
          : currentMessages

        // 每步调一次 streamText，stopWhen=[stepCountIs(1)] 强制单步执行
        const effectiveTemperature = llmConfig.temperature ?? 0.7

        // 工具层保持固定；收尾步骤通过 toolChoice 禁止调用，而不是替换工具集合。
        const stepTools = runContext.tools

        const stepStartTime = performance.now()
        await runtimeHooks.emit('step.started', {
          stepIndex,
          messageCount: stepMessages.length,
          toolCount: Object.keys(stepTools).length,
          forcingFinalResponse,
        })

        // 记录传给模型的内容（精简版：仅文本片段，避免日志膨胀）
        const msgSummary = stepMessages.map(m => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          return `${m.role}: ${content.length > 100 ? content.slice(0, 100) + '…' : content}`
        }).join(' | ')
        logger.info(`[AgentLoop] Step ${stepIndex + 1} → 模型`, {
          ...baseMeta,
          stepIndex,
          systemLength: runContext.systemPrompt.length,
          extra: {
            messageCount: stepMessages.length,
            messagesPreview: msgSummary,
            toolCount: stepTools ? Object.keys(stepTools).length : 0,
          },
        }, ['agent', 'loop', 'model-input'])

        // 记录上下文快照：保存每一步实际传给 LLM 的完整消息列表
        if (conversationId) {
          recordContextSnapshot(conversationId, stepIndex, stepMessages)
        }

        const result = streamText({
          model,
          system: runContext.systemPrompt,
          tools: stepTools as Parameters<typeof streamText>[0]['tools'],
          toolChoice: forcingFinalResponse ? 'none' : 'auto',
          temperature: effectiveTemperature,
          messages: stepMessages,
          abortSignal,  // 仅用户停止时触发（来自 LoopRegistry 的 AbortController）
          stopWhen: stepCountIs(1),
          providerOptions: cacheProviderOptions,
          experimental_repairToolCall: async ({ toolCall }) => {
            let parsedInput: unknown
            try {
              parsedInput = JSON.parse(toolCall.input)
            } catch {
              return null
            }
            if (getPublicToolReason(parsedInput)) return null

            const cleanInput = withoutPublicToolReason(parsedInput)
            let publicReason: string | undefined
            for (let attempt = 0; attempt < 2 && !publicReason; attempt += 1) {
              const rationaleResult = await generateText({
                model,
                system: [
                  '你是 Agent 的公开执行说明生成器，不执行工具。',
                  '只输出一句给用户看的自然语言说明，不得输出工具调用、XML、JSON、Markdown 或字段名。',
                  '像正在协作的工程师一样自然表达：用上一条结果里的新事实引出下一步，不要复述界面已经显示的工具动作、文件路径或输入。',
                  '如果同一步有多个服务于同一目的的只读调用，为它们生成完全相同的一段批次说明；说明只放进公开理由字段，不要另外输出一行叙述。',
                  '连续步骤要变换句式；不要反复以“需要……”“我先……”“我正在……”或“接下来……”开头，也不要套用“这将帮助我们……”等报告腔。',
                  '示例：“目录里只有一个公开入口，我沿着它的导出关系进入核心实现。”“engine.ts 把检索交给 Pipeline；再核对 pipeline.ts 就能锁定主调用链。”',
                  '这不是私有思维链，不披露隐藏推理。必须与用户问题使用相同语言。',
                ].join(''),
                prompt: [
                  `<用户问题>${(prompt || '用户要求继续当前任务').slice(0, 2_000)}</用户问题>`,
                  `<下一动作>使用 ${toolCall.toolName} 获取必要证据；输入摘要为 ${JSON.stringify(cleanInput).slice(0, 1_000)}</下一动作>`,
                  attempt === 0
                    ? '直接写公开执行说明。'
                    : '上一次格式不合格。只写自然语言句子，不能复述工具协议。',
                ].join('\n'),
                temperature: 0.2,
                abortSignal,
              })
              const candidate = normalizePublicToolReason(rationaleResult.text)
              if (candidate && matchesUserLanguage(candidate, prompt)) {
                publicReason = candidate
              }
            }
            if (!publicReason) return null

            return {
              ...toolCall,
              input: JSON.stringify(setPublicToolReason(cleanInput, publicReason)),
            }
          },
        })
        guardStreamResultPromises(result)

        // 收集本步结果
        const stepCollect: StepCollect = {
          text: '',
          toolCalls: [],
          toolResults: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          finishReason: '',
        }
        const emittedToolRationales = new Set<string>()

        // 遍历 fullStream：收集数据 + 逐个通过 onChunk 输出
        for await (const chunk of result.fullStream) {
          if (chunk.type === 'tool-call') {
            const publicProgressText = getPublicToolReason(chunk.input)
            if (!publicProgressText) {
              throw new Error(`Tool ${chunk.toolName} did not provide a public action rationale`)
            }
            if (!emittedToolRationales.has(publicProgressText)) {
              emittedToolRationales.add(publicProgressText)
              stepCollect.publicProgressText = stepCollect.publicProgressText
                ? `${stepCollect.publicProgressText}\n${publicProgressText}`
                : publicProgressText
              await runtimeHooks.emit('step.progress', {
                stepIndex,
                text: publicProgressText,
              })
            }
          }

          // 将 fullStream chunk 转换为 UIMessageChunk 格式并立即输出
          const transformed = transformChunk(chunk as { type: string; [key: string]: unknown }, conversationId, messageId)
          if (transformed) {
            sendChunk(transformed)
          }

          // 同时收集到 stepCollect
          switch (chunk.type) {
            case 'error':
              // AI SDK v5+ 通过 fullStream 发射 error chunk，而不是抛异常
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const errorFromChunk = (chunk as any).error ?? chunk
              const errorInfo = formatAIError(errorFromChunk)
              const friendlyMessage = formatErrorForSSE(errorInfo)
              sendChunk({ type: 'error', errorText: friendlyMessage })
              // 保存错误信息到对话历史
              if (onError) {
                await onError(friendlyMessage)
              }
              await runtimeHooks.emit('loop.failed', {
                error: friendlyMessage,
                durationMs: Math.round(performance.now() - turnStartTime),
                stepIndex,
              })
              notifyDone()
              return

            case 'text-delta':
              // 首字延迟（TTFT）— 仅记录第一次
              if (!ttftMeasured) {
                ttftMs = Math.round(performance.now() - turnStartTime)
                ttftMeasured = true
              }
              stepCollect.text += chunk.text
              break
            case 'tool-call':
              stepCollect.toolCalls.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: withoutPublicToolReason(chunk.input),
              })
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
              {
                const waiting = findWaitingForInputError(chunk.error)
                if (waiting) throw waiting
              }
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
                const details = chunk.totalUsage.inputTokenDetails
                stepCollect.usage = {
                  inputTokens: chunk.totalUsage.inputTokens ?? 0,
                  outputTokens: chunk.totalUsage.outputTokens ?? 0,
                  cacheReadTokens: details?.cacheReadTokens ?? undefined,
                  cacheWriteTokens: details?.cacheWriteTokens ?? undefined,
                  noCacheTokens: details?.noCacheTokens ?? undefined,
                }
                // 用 API 返回的精确 prompt_tokens 校准 TokenTracker
                tokenTracker.updateFromAPI(stepCollect.usage.inputTokens)
              }
              break
          }
        }

        // ── 发送当前步骤的 token 用量到前端（实时渲染，不等 loop 结束）──
        if (stepCollect.usage.inputTokens > 0 || stepCollect.usage.outputTokens > 0) {
          sendChunk({
            type: 'manta:step-usage',
            stepIndex,
            usage: {
              inputTokens: stepCollect.usage.inputTokens,
              outputTokens: stepCollect.usage.outputTokens,
              cacheReadTokens: stepCollect.usage.cacheReadTokens,
              cacheWriteTokens: stepCollect.usage.cacheWriteTokens,
              noCacheTokens: stepCollect.usage.noCacheTokens,
            },
            toolNames: stepCollect.toolCalls.length > 0
              ? stepCollect.toolCalls.map(c => c.toolName)
              : undefined,
          })
        }

        const stepDurationMs = Math.round(performance.now() - stepStartTime)
        await runtimeHooks.emit('step.completed', {
          stepIndex,
          durationMs: stepDurationMs,
          textLength: stepCollect.text.length,
          toolNames: stepCollect.toolCalls.map(call => call.toolName),
          toolErrorCount: stepCollect.toolResults.filter(result => result.isError).length,
          finishReason: stepCollect.finishReason,
          usage: stepCollect.usage,
        })

        // ── 提取 Prompt Cache 命中信息 ──
        if (promptCacheEnabled) {
          try {
            // result.providerMetadata 在 fullStream 消费完成后可用
            const cacheHit = extractCacheHit(await result.providerMetadata)
            if (cacheHit) {
              stepCollect.cacheHitStats = {
                cachedPromptTokens: cacheHit.cachedPromptTokens,
                hitRate: cacheHit.hitRate,
              }
              cacheAccumulator.record(cacheHit.cachedPromptTokens, stepCollect.usage.inputTokens)
            } else {
              // 没有缓存命中也记录（用于统计缓存失效率）
              cacheAccumulator.record(0, stepCollect.usage.inputTokens)
            }
          } catch {
            // providerMetadata 访问失败，不影响主流程
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

        // 记录步骤日志（简洁版：模型输出 + 步骤完成）
        if (stepCollect.text) {
          logger.modelOutput(stepIndex, stepCollect.text, {
            inputTokens: stepCollect.usage.inputTokens,
            outputTokens: stepCollect.usage.outputTokens,
            cacheReadTokens: stepCollect.usage.cacheReadTokens,
            cacheWriteTokens: stepCollect.usage.cacheWriteTokens,
            noCacheTokens: stepCollect.usage.noCacheTokens,
          }, {
            ...baseMeta,
            extra: {
              promptCacheHitTokens: stepCollect.cacheHitStats?.cachedPromptTokens,
              promptCacheHitRate: stepCollect.cacheHitStats?.hitRate,
            },
          })
        }

        logger.agentLoop(
          stepIndex,
          currentMessages.length,
          stepCollect.toolCalls.length,
          totalOutputTokens,
          {
            ...baseMeta,
            durationMs: stepDurationMs,
          },
          stepCollect.usage,
        )

        if (forcingFinalResponse) {
          const finalAction = decideBlankFinalResponse(
            stepCollect.text,
            stepCollect.toolCalls.length,
            blankFinalResponseRetries,
          )
          if (finalAction === 'not-blank') break
          if (finalAction === 'fail') {
            throw new Error('模型在强制收尾后仍未生成有效文本，任务不能标记为成功')
          }
          blankFinalResponseRetries++
          warningMessage = '[收尾要求] 必须立即输出完整最终答复，不要调用工具，也不要只输出空白内容。'
        } else {
          // 判断退出条件（一次调用，包含 warning 检测）
          const decision = decideStop(
            stepCollect,
            loopDetector,
            totalOutputTokens,
            stepIndex,
            maxOutputTokens,
            maxSteps,
            blankFinalResponseRetries,
          )
          if (decision.reason === 'blank-final-response-failed') {
            throw new Error('模型在强制收尾后仍未生成有效文本，任务不能标记为成功')
          }
          if (decision.shouldStop) {
            // 步数、Token 或循环熔断发生在工具步骤时，先提交工具结果，
            // 再执行一个禁用工具的收尾步骤，而不是把半截调查当成答案。
            if (needsFinalResponseSynthesis(stepCollect.text, stepCollect.toolCalls.length)) {
              forcingFinalResponse = true
              warningMessage = '[收尾要求] 已达到本轮执行边界。请基于已有工具结果直接输出完整最终答复，不要再调用工具。'
            } else {
              break
            }
          }
          if (decision.reason === 'blank-final-response-retry') {
            blankFinalResponseRetries++
            forcingFinalResponse = true
          }
          if (decision.warningToInject) {
            loopDetectionCount++
            warningMessage = decision.warningToInject
            logger.warn(`[LoopDetector] ${warningMessage}`, {
              ...baseMeta,
              stepIndex,
              extra: { warning: warningMessage },
            }, ['agent', 'loop', 'warning'])
          }
        }

        // 记录追加前消息数量，用于时间戳追踪
        const msgCountBefore = currentMessages.length

        // 将步骤结果追加到消息列表
        currentMessages = appendStepToMessages(currentMessages, stepCollect, conversationId, stepIndex, messageId)

        // 记录新追加消息的时间戳
        const msgCountAfter = currentMessages.length
        timestampTracker.recordNewMessages(msgCountBefore, msgCountAfter - msgCountBefore)

        // Microcompact: 清理旧的查询类工具结果，减少上下文 token 占用
        // 保留最近 3 个工具结果不动，只清理更早的
        if (microcompactEnabled) {
          const microcompactResult = applyMicrocompactWithLogging(currentMessages, conversationId, messageId, stepIndex)
          if (microcompactResult.clearedCount > 0) {
            await runtimeHooks.emit('context.optimized', {
              stepIndex,
              strategy: 'microcompact',
              affectedCount: microcompactResult.clearedCount,
              messageCountBefore: currentMessages.length,
              messageCountAfter: currentMessages.length,
            })
          }
        }

        // Layer 2 动态截断: 对剩余工具结果做双重约束截断
        // Pass 1 — 单条超过窗口 50% 的做 Head/Tail 60/40 分割
        // Pass 2 — 总字符数超过窗口 75% 时，从最老的 tool result 开始逐条 compact
        const truncateResult = truncateToolResultsWithLogging(
          currentMessages, conversationId, messageId, stepIndex,
        )
        if (truncateResult.truncated > 0 || truncateResult.compacted > 0) {
          const messageCountBefore = currentMessages.length
          currentMessages = truncateResult.messages
          await runtimeHooks.emit('context.optimized', {
            stepIndex,
            strategy: 'truncate',
            affectedCount: truncateResult.truncated + truncateResult.compacted,
            messageCountBefore,
            messageCountAfter: currentMessages.length,
          })
        }

        // Layer 3 TTL 修剪: 时间衰减，老的工具结果自动退化
        // 软修剪（5min）：Head/Tail 保留，中间替换
        // 硬清除（10min）：整个结果替换为过期标记
        if (ttlPruneEnabled) {
          const ttlResult = ttlPruneWithLogging(
            currentMessages,
            timestampTracker.getTimestamps(),
            conversationId,
            messageId,
            stepIndex,
          )
          if (ttlResult.softPruned > 0 || ttlResult.hardPruned > 0) {
            const messageCountBefore = currentMessages.length
            currentMessages = ttlResult.messages
            await runtimeHooks.emit('context.optimized', {
              stepIndex,
              strategy: 'ttl-prune',
              affectedCount: ttlResult.softPruned + ttlResult.hardPruned,
              messageCountBefore,
              messageCountAfter: currentMessages.length,
            })
          }
        }

        // Compaction: LLM 摘要压缩（在 Microcompact + 动态截断 + TTL 修剪之后检查，避免频繁触发）
        // 当消息列表 token 数超过阈值时，将早期对话压缩为结构化摘要
        if (compactionEnabled) {
          const compactionResult = await compactMessages(currentMessages)
          if (compactionResult.compressedCount > 0) {
            const messageCountBefore = currentMessages.length
            // 通知 timestamp tracker 消息列表已被替换
            timestampTracker.onCompaction(
              currentMessages.length - compactionResult.messages.length + 1, // 被移除的消息数
              1, // 插入的摘要消息数
            )
            currentMessages = compactionResult.messages
            await runtimeHooks.emit('context.optimized', {
              stepIndex,
              strategy: 'llm-compaction',
              affectedCount: compactionResult.compressedCount,
              messageCountBefore,
              messageCountAfter: currentMessages.length,
            })
          }
        }

        const nextStepIndex = stepIndex + 1
        await onStepCommitted?.({ messages: currentMessages, steps: allStepCollects, nextStepIndex })
        await runtimeHooks.emit('step.committed', {
          stepIndex,
          nextStepIndex,
          messageCount: currentMessages.length,
        })
        stepIndex = nextStepIndex
      }

      // ── Agent Loop 整体完成：计算聚合指标 ──
      const totalUsage = allStepCollects.reduce(
        (acc, step) => ({
          inputTokens: acc.inputTokens + step.usage.inputTokens,
          outputTokens: acc.outputTokens + step.usage.outputTokens,
          cacheReadTokens: (acc.cacheReadTokens ?? 0) + (step.usage.cacheReadTokens ?? 0),
          cacheWriteTokens: (acc.cacheWriteTokens ?? 0) + (step.usage.cacheWriteTokens ?? 0),
          noCacheTokens: (acc.noCacheTokens ?? 0) + (step.usage.noCacheTokens ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0 } as StepUsage
      )
      const totalSteps = allStepCollects.length
      const totalToolCalls = allStepCollects.reduce((n, s) => n + s.toolCalls.length, 0)
      const totalToolErrors = allStepCollects.reduce(
        (n, s) => n + s.toolResults.filter(r => r.isError).length, 0)
      const totalDurationMs = Math.round(performance.now() - turnStartTime)
      const totalTokens = totalUsage.inputTokens + totalUsage.outputTokens
      const cacheHitRate = totalUsage.inputTokens > 0
        ? (totalUsage.cacheReadTokens ?? 0) / totalUsage.inputTokens
        : 0
      const toolSuccessRate = totalToolCalls > 0
        ? (totalToolCalls - totalToolErrors) / totalToolCalls
        : 0

      // ── 收集各步骤的 StepMetrics ──
      const stepMetricsList: StepMetrics[] = allStepCollects.map((sc, idx) => {
        const toolResults = sc.toolResults
        return {
          stepIndex: idx,
          toolNames: sc.toolCalls.map(c => c.toolName),
          toolCallCount: sc.toolCalls.length,
          toolErrorCount: toolResults.filter(r => r.isError).length,
          hasText: !!sc.text,
          textLength: sc.text.length,
          finishReason: sc.finishReason,
          usage: {
            inputTokens: sc.usage.inputTokens,
            outputTokens: sc.usage.outputTokens,
            cacheReadTokens: sc.usage.cacheReadTokens,
            cacheWriteTokens: sc.usage.cacheWriteTokens,
            noCacheTokens: sc.usage.noCacheTokens,
          },
          timing: { durationMs: 0 }, // per-step timing not tracked individually
          promptCacheHitTokens: sc.cacheHitStats?.cachedPromptTokens,
          promptCacheHitRate: sc.cacheHitStats?.hitRate,
        }
      })

      // ── 获取累计 Prompt Cache 统计 ──
      const cumulativeCacheStats = promptCacheEnabled
        ? cacheAccumulator.getStats()
        : null

      // ── 构建并记录 TurnMetrics ──
      const turnMetrics: TurnMetrics = {
        messageId,
        conversationId: conversationId ?? '',
        prompt: (prompt ?? '').slice(0, 80),
        totalDurationMs,
        ttftMs,
        totalSteps,
        totalInputTokens: totalUsage.inputTokens,
        totalOutputTokens: totalUsage.outputTokens,
        totalTokens,
        cacheReadTokens: totalUsage.cacheReadTokens ?? 0,
        cacheWriteTokens: totalUsage.cacheWriteTokens ?? 0,
        cacheHitRate,
        promptCacheHitTokens: cumulativeCacheStats?.totalCachedTokens,
        promptCacheHitRate: cumulativeCacheStats?.overallHitRate,
        promptCacheStepsWithHit: cumulativeCacheStats?.stepsWithCacheHit,
        totalToolCalls,
        toolCallSuccessCount: totalToolCalls - totalToolErrors,
        toolCallErrorCount: totalToolErrors,
        toolCallSuccessRate: toolSuccessRate,
        loopDetectionCount,
        stopReason: allStepCollects[allStepCollects.length - 1]?.finishReason ?? 'stop',
        steps: stepMetricsList,
        model: llmConfig.model,
        provider: llmConfig.provider,
      }
      recordTurn(turnMetrics)

      // ── 单条结构化日志：一屏看完所有关键指标 ──
      const cacheStr = totalUsage.cacheReadTokens
        ? ` | cache:+${totalUsage.cacheReadTokens}`
        : ''
      const promptCacheStr = cumulativeCacheStats && cumulativeCacheStats.totalCachedTokens > 0
        ? ` | promptCache:${cumulativeCacheStats.totalCachedTokens}(${Math.round(cumulativeCacheStats.overallHitRate * 100)}%)`
        : ''
      logger.info(
        `[AgentLoop] 完成 · ${totalSteps}步 · ${totalToolCalls}工具(${totalToolErrors}错) · ` +
        `${totalDurationMs}ms · TTFT=${ttftMs}ms · ` +
        `token:${totalTokens}${cacheStr}${promptCacheStr} · 停止:${turnMetrics.stopReason}`,
        {
          ...baseMeta,
          durationMs: totalDurationMs,
          extra: {
            ttftMs,
            totalSteps,
            totalToolCalls,
            totalToolErrors,
            toolSuccessRate,
            totalInputTokens: totalUsage.inputTokens,
            totalOutputTokens: totalUsage.outputTokens,
            totalTokens,
            cacheReadTokens: totalUsage.cacheReadTokens,
            cacheWriteTokens: totalUsage.cacheWriteTokens,
            cacheHitRate,
            promptCacheHitTokens: cumulativeCacheStats?.totalCachedTokens,
            promptCacheHitRate: cumulativeCacheStats?.overallHitRate,
            promptCacheStepsWithHit: cumulativeCacheStats?.stepsWithCacheHit,
            loopDetectionCount,
            stopReason: turnMetrics.stopReason,
          },
        },
        ['agent', 'loop', 'turn-summary']
      )

      // 调用 onFinish 回调（流结束后持久化消息）
      if (onFinish) {
        // 只有最后一个无工具步骤才是面向用户的最终回答；此前文本属于执行过程。
        const finalText = allStepCollects[allStepCollects.length - 1]?.text.trim() ?? ''
        if (!finalText) {
          throw new Error('Agent loop ended without a valid final response')
        }

        const stepsForCallback = allStepCollects.map((s) => ({
          finishReason: s.finishReason,
          progressText: s.toolCalls.length > 0
            ? (s.publicProgressText ?? (s.text.trim() || undefined))
            : undefined,
          toolCalls: s.toolCalls,
          toolResults: s.toolResults,
          usage: s.usage,
        }))

        await onFinish({
          text: finalText,
          steps: stepsForCallback,
          totalUsage,
          usage: totalUsage,
          durationMs: totalDurationMs,
          totalSteps,
          totalToolCalls,
          totalToolErrors,
          finishReason: allStepCollects[allStepCollects.length - 1]?.finishReason ?? 'stop',
        })
      }
      await runtimeHooks.emit('loop.completed', {
        durationMs: totalDurationMs,
        totalSteps,
        totalToolCalls,
        totalToolErrors,
        totalInputTokens: totalUsage.inputTokens,
        totalOutputTokens: totalUsage.outputTokens,
        cacheReadTokens: totalUsage.cacheReadTokens,
        cacheWriteTokens: totalUsage.cacheWriteTokens,
        noCacheTokens: totalUsage.noCacheTokens,
        stopReason: turnMetrics.stopReason,
      })
    } catch (err) {
      const waiting = findWaitingForInputError(err)
      if (waiting) {
        suspendedForInput = true
        await runtimeHooks.emit('loop.suspended', { reason: 'waiting-for-input', stepIndex })
        throw waiting
      }
      // 区分「用户主动停止」和「真正的错误」
      const isAborted = abortSignal?.aborted ?? false
      if (isAborted) {
        await runtimeHooks.emit('loop.aborted', { reason: 'abort-signal', stepIndex })
        notifyDone()
        return
      }

      logger.error('[AgentLoop] 执行异常:', err instanceof Error ? err : new Error(String(err)), {
        ...baseMeta,
        stepIndex,
        durationMs: Math.round(performance.now() - turnStartTime),
      }, ['agent', 'loop', 'error'])
      // 将技术错误转换为用户友好的提示
      const errorInfo = formatAIError(err)
      const friendlyMessage = formatErrorForSSE(errorInfo)
      sendChunk({ type: 'error', errorText: friendlyMessage })
      // 保存错误信息到对话历史
      if (onError) {
        await onError(friendlyMessage)
      }
      await runtimeHooks.emit('loop.failed', {
        error: friendlyMessage,
        durationMs: Math.round(performance.now() - turnStartTime),
        stepIndex,
      })
      if (throwOnError) throw err
    } finally {
      if (!suspendedForInput) notifyDone()
    }
  }

  // 在安全上下文中执行 Agent Loop（如果提供了安全上下文）
  // ★ 必须使用 await 确保 async executeLoop 完整在 ALS 作用域内执行
  await runWithAgentRuntimeHooks(runtimeHooks, () => {
    if (securityContext) {
      return runWithSecurityContext(securityContext, () => executeLoop())
    }
    return executeLoop()
  })
}
