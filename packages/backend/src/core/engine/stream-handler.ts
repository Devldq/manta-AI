/* AI start: 流式聊天核心处理逻辑 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { createHash } from 'node:crypto'
import { getLLMConfig } from '@llm/config-store'
import {
  appendMessage,
  getConversation,
  updateConversationContext,
} from '@storage/conversation/store'
import {
  appendWorkspaceMessage,
  getWorkspace,
  getWorkspaceConversation,
  updateWorkspaceConversationContext,
} from '@storage/workspace/store'
import type { ToolCallRecord, StepUsageRecord } from '@storage/conversation/types'
import { readAgentSoul } from '@context/agent-soul'
import {
  buildSystemPromptWithStats,
  createMantaPromptBuilder,
  type PromptContext,
  type RuntimeSecurityFacts,
} from '@context/prompt-builder'
import { getAgentPromptToolContext } from '@tools/mcp/setup'
import { parseMessagesToCore, type UIMessage } from './message-parser'
import { runAgentLoop, type AgentLoopResumeState } from './agent-loop'
import { getActiveLoop, registerLoop, emitLoopEvent } from './loop-registry'
import { logger, logManager } from '@observability/log'
// 使用共享安全上下文模块（解决 tsx 模块解析问题）
import { createDefaultSecurityContext, type SecurityApprovalRequest } from '../security-context'
import type { JobExecutorContext } from '@manta/task-runtime'
import type { AgentRunSnapshot, AgentRunUsage, JsonValue } from '@manta/contracts'
import { approvalManager } from '../security/ApprovalManager'
import { getApprovalPolicy } from '../security/approval-policy.js'
import type { ProcessRegistry } from './runner/process-registry'
import type { AgentRuntimeExtension } from './runtime-hooks'
import { AgentPublicEventProjector } from './agent-public-events'
import {
  INTENT_GATE_CONTEXT_KEY,
  buildIntentExecutionPrompt,
  nextIntentGateState,
  readPendingIntentPlan,
  renderIntentResponse,
  resolveImmediateIntent,
  resolveIntentExecutionPlan,
  type IntentAnalysis,
  type PendingIntentPlan,
} from './intent-classifier'

/** ★ 解析工作空间 folderPath 为绝对路径，处理 showDirectoryPicker 只返回目录名的 bug */
function resolveFolderPath(folderPath?: string): string | null {
  if (!folderPath) return null

  // 已经是绝对路径且存在 → 直接使用
  if (path.isAbsolute(folderPath)) {
    try {
      if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
        return folderPath
      }
    } catch {}
    logger.warn(`[Security] workspace folderPath 指向不存在的目录: ${folderPath}`, undefined, ['security', 'context'])
    return null
  }

  // 相对路径 → 可能是 showDirectoryPicker 的 bug（只返回目录名）
  // 尝试常见基路径解析
  const candidates: Array<{ label: string; candidate: string }> = [
    { label: 'cwd', candidate: path.resolve(process.cwd(), folderPath) },
    { label: 'home', candidate: path.join(os.homedir(), folderPath) },
    { label: 'Desktop', candidate: path.join(os.homedir(), 'Desktop', folderPath) },
    { label: 'Documents', candidate: path.join(os.homedir(), 'Documents', folderPath) },
  ]

  for (const { label, candidate } of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        logger.info(`[Security] workspace folderPath "${folderPath}" 解析为: ${candidate} (base: ${label})`, undefined, ['security', 'context'])
        return candidate
      }
    } catch {}
  }

  logger.warn(`[Security] 无法解析 workspace folderPath "${folderPath}" 到任何已存在目录`, undefined, ['security', 'context'])
  return null
}

/** 流式聊天选项 */
export interface StreamChatOptions {
  messages: UIMessage[]
  agentName: string
  conversationId: string
  workspaceId?: string
  /** Durable Job execution context. When present no LoopRegistry state is required. */
  jobContext?: JobExecutorContext
  messageId?: string
  processRegistry?: ProcessRegistry
  /** Optional observers for this run (tracing, audit, replay, custom logs). */
  runtimeExtensions?: AgentRuntimeExtension[]
}

/** 启动结果的返回类型 */
export interface StreamChatResult {
  /** 是否是新启动的循环（true）还是已有活跃循环（false） */
  isNew: boolean
  completion: Promise<void>
  assistantMessageId: string
}

interface IntentAnalysisCheckpoint {
  analysis: IntentAnalysis
  /** Retained after conversation context is cleared so a durable retry uses the exact confirmed plan. */
  executionPlan?: PendingIntentPlan
}

/**
 * 启动流式聊天 Agent Loop（如果该会话已有活跃循环则不重复启动）
 * Loop 与 HTTP 连接完全解耦，通过 LoopRegistry 广播事件
 */
export async function startAgentLoop({ messages, agentName, conversationId, workspaceId, jobContext, messageId: durableMessageId, processRegistry, runtimeExtensions }: StreamChatOptions): Promise<StreamChatResult> {
  const startupStartedAt = performance.now()
  const reportStartupPhase = (phase: string) => {
    const elapsedMs = Math.round(performance.now() - startupStartedAt)
    jobContext?.emit('log', {
      channel: 'agent.startup',
      phase,
      elapsedMs,
    })
  }
  reportStartupPhase('request.accepted')

  // 如果已有活跃循环，不重复启动
  const activeLoop = getActiveLoop(conversationId)
  if (!jobContext && activeLoop) {
    return { isNew: false, completion: activeLoop.running, assistantMessageId: `legacy-${conversationId}` }
  }

  // 提取用户最新输入的 prompt（用于日志记录）
  const lastUIMessage = [...messages].reverse().find(m => m.role === 'user')
  const userPrompt = lastUIMessage?.parts
    ? lastUIMessage.parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('')
    : (lastUIMessage?.content ?? '')

  // 获取 LLM 配置信息
  const llmConfig = getLLMConfig()
  if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
    throw new Error('LLM 未配置 API Key，请前往 Settings → AI 模型 进行配置')
  }
  const modelInfo = { model: llmConfig.model, provider: llmConfig.provider }

  // 提前生成 messageId（整轮 agent loop 共享，确保早期日志也能立即关联到会话）
  const messageId = durableMessageId ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const assistantMessageId = jobContext ? `${jobContext.job.id}:assistant` : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 解析消息格式。执行前意图门禁只接收对话文本，不暴露任何工具。
  const coreMessages = parseMessagesToCore(messages)
  reportStartupPhase('messages.parsed')

  if (jobContext && userPrompt) {
    const persisted = workspaceId
      ? appendWorkspaceMessage(workspaceId, conversationId, 'user', userPrompt, undefined, undefined, undefined, undefined, messageId)
      : appendMessage(conversationId, 'user', userPrompt, undefined, undefined, undefined, undefined, messageId)
    if (!persisted) throw new Error(`Conversation ${conversationId} was not found`)
    jobContext.checkpoint('user_message_committed', { messageId })
  }
  reportStartupPhase('user.persisted')

  const conversation = workspaceId
    ? getWorkspaceConversation(workspaceId, conversationId)
    : getConversation(conversationId)
  if (!conversation) throw new Error(`Conversation ${conversationId} was not found`)
  reportStartupPhase('conversation.loaded')
  const pendingIntentPlan = readPendingIntentPlan(conversation.context)

  const intentCheckpoint = jobContext?.readCheckpoint('intent_analysis') as unknown as IntentAnalysisCheckpoint | undefined
  let intentAnalysis = intentCheckpoint?.analysis
  let confirmedIntentPlan = intentCheckpoint?.executionPlan
  if (!intentAnalysis) {
    // Do not put model-authored classification in front of the streaming
    // Agent. Two serial preflight completions made the UI wait for minutes
    // before the first visible Agent content and could drift from the user's
    // language. The main Agent owns planning and clarification; this fast path
    // only preserves an explicit confirmation of a persisted plan.
    intentAnalysis = resolveImmediateIntent(userPrompt, pendingIntentPlan)
    confirmedIntentPlan = resolveIntentExecutionPlan(intentAnalysis, pendingIntentPlan, messageId)
    jobContext?.checkpoint('intent_analysis', {
      analysis: intentAnalysis,
      ...(confirmedIntentPlan ? { executionPlan: confirmedIntentPlan } : {}),
    } as unknown as JsonValue)
  }

  jobContext?.emit('log', {
    channel: 'agent.intent',
    analysis: intentAnalysis as unknown as JsonValue,
  })
  reportStartupPhase('intent.resolved')

  const nextGateState = nextIntentGateState(intentAnalysis, pendingIntentPlan, messageId)
  const updatedConversation = workspaceId
    ? updateWorkspaceConversationContext(workspaceId, conversationId, {
        [INTENT_GATE_CONTEXT_KEY]: nextGateState,
      })
    : updateConversationContext(conversationId, {
        [INTENT_GATE_CONTEXT_KEY]: nextGateState,
      })
  if (!updatedConversation) throw new Error(`Conversation ${conversationId} was not found`)
  reportStartupPhase('conversation.updated')

  if (intentAnalysis.decision !== 'execute') {
    const response = renderIntentResponse(intentAnalysis, userPrompt)
    return completeIntentGateTurn({
      conversationId,
      workspaceId,
      userPrompt,
      messageId,
      assistantMessageId,
      response,
      jobContext,
    })
  }
  const executionPlan = confirmedIntentPlan
    ?? resolveIntentExecutionPlan(intentAnalysis, pendingIntentPlan, messageId)
  if (!executionPlan) {
    throw new Error('Intent gate allowed execution without a valid execution plan')
  }
  const executionMode = intentAnalysis.executionMode === 'direct' ? 'direct' : 'confirmed_plan'

  // ★ 确定工作目录：有工作空间则解析并使用工作空间路径，否则用 process.cwd()
  const workspace = workspaceId ? getWorkspace(workspaceId) : null
  const resolvedFolderPath = resolveFolderPath(workspace?.folderPath)
  const cwd = resolvedFolderPath || process.cwd()
  const approvalMode = getApprovalPolicy().mode
  const securityContext = resolvedFolderPath || jobContext
    ? createDefaultSecurityContext(jobContext?.job.id ?? conversationId, approvalMode)
    : undefined
  if (securityContext) {
    securityContext.workspaceId = workspaceId
    if (resolvedFolderPath) {
      securityContext.allowedRoots = [resolvedFolderPath]
      securityContext.shellAllowedRoots = [resolvedFolderPath]
    }
  }
  const runtimeFacts: RuntimeSecurityFacts = {
    approvalMode,
    securityContextAvailable: Boolean(securityContext),
    allowedRoots: securityContext?.allowedRoots ?? [],
    shellAllowedRoots: securityContext?.shellAllowedRoots ?? [],
    allowExternalRead: securityContext?.allowExternalRead ?? false,
    allowExternalWrite: securityContext?.allowExternalWrite ?? false,
    networkAccess: securityContext?.networkAccess,
  }

  // 构建 system prompt builder（每步 API 调用时重新 build，确保新存记忆立即可见）
  const soulPrompt = readAgentSoul(agentName)
  const promptBuilder = createMantaPromptBuilder({ cwd, soulPrompt, runtimeFacts })
  reportStartupPhase('prompt.builder.created')

  // 每步重建 system prompt 的闭包：memoryContext pipe 内部实时读 MemoryStore
  const buildSystemPrompt = async (): Promise<string> => {
    const toolContext = await getAgentPromptToolContext(agentName)
    const ctx: PromptContext = {
      toolCount: toolContext.toolCount,
      deferredToolSummary: toolContext.deferredToolSummary,
      sessionMessageCount: messages.length,
      sessionId: conversationId,
    }
    return buildIntentExecutionPrompt(promptBuilder.build(ctx), executionPlan, executionMode)
  }

  // 首次构建获取初始 system prompt + 统计
  const { prompt: baseSystemPrompt, stats: pipeStats } = await buildSystemPromptWithStats({
    soulPrompt,
    cwd,
    runtimeFacts,
    agentName,
    sessionId: conversationId,
    sessionMessageCount: messages.length,
    conversationId,
    messageId,
  })
  reportStartupPhase('prompt.initial.completed')
  const systemPrompt = buildIntentExecutionPrompt(baseSystemPrompt, executionPlan, executionMode)

  // 简洁启动日志：模型 + prompt 摘要 + pipe 统计
  const promptPreview = userPrompt.length > 60 ? userPrompt.slice(0, 60) + '…' : userPrompt
  logger.system('AgentLoop', `开始 · ${modelInfo.model} · "${promptPreview}" · prompt=${systemPrompt.length}chars(~${pipeStats.reduce((s, p) => s + p.estimatedTokens, 0)}tokens)(${pipeStats.filter(s => s.enabled).length}/${pipeStats.length} pipes)`, 'pending', {
    conversationId,
    messageId,
    agentName,
    prompt: userPrompt,
    model: modelInfo.model,
    provider: modelInfo.provider,
    messageCount: messages.length,
    systemLength: systemPrompt.length,
    hasSoul: !!soulPrompt,
    soulLength: soulPrompt?.length ?? 0,
    extra: {
      pipePieces: pipeStats.filter(s => s.enabled).map(s => s.name),
      pipeTokens: Math.ceil(systemPrompt.length / 2.5),
    },
  })

  // 创建安全上下文（用于路径校验、命令校验等安全检查）
  const resumeState = jobContext?.readCheckpoint('agent_loop_state') as unknown as AgentLoopResumeState | undefined
  let durableStepIndex = resumeState?.nextStepIndex ?? 0
  let approvalInput = jobContext?.consumeInput() as { approvalId?: string; decision?: 'approve' | 'deny' } | undefined
  if (securityContext) {
    if (jobContext) {
      securityContext.abortSignal = jobContext.signal
      securityContext.jobId = jobContext.job.id
      securityContext.attempt = jobContext.attempt
      securityContext.registerProcess = processRegistry ? (pid, label) => processRegistry.register(jobContext.job.id, pid, label, { jobId: jobContext.job.id, attempt: jobContext.attempt }) : undefined
      securityContext.unregisterProcess = processRegistry ? (pid) => processRegistry.cleanupProcess(jobContext.job.id, pid) : undefined
      securityContext.onApprovalRequest = async (approval) => handleDurableApproval(jobContext, approval, durableStepIndex, () => approvalInput, (value) => { approvalInput = value })
    }
    logger.info(`[Security] 初始化安全上下文，允许路径: ${resolvedFolderPath}`, {
      conversationId,
      extra: {
        workspaceId,
      },
    }, ['security', 'context'])
  }

  // Durable jobs persist the same ordered runtime event stream used by custom
  // extensions. This makes lifecycle history available for diagnostics and replay.
  const effectiveRuntimeExtensions: AgentRuntimeExtension[] = [...(runtimeExtensions ?? [])]
  const resumedPublicSnapshot = jobContext?.readCheckpoint('agent_public_snapshot') as unknown as AgentRunSnapshot | undefined
  const publicProjector = new AgentPublicEventProjector({
    runId: jobContext?.job.id ?? messageId,
    conversationId,
    messageId: assistantMessageId,
  }, event => {
    if (jobContext) {
      const emitted = jobContext.emit('log', {
        channel: 'agent.public',
        event: event as unknown as JsonValue,
      })
      return emitted.seq
    }
    emitLoopEvent(conversationId, `data: ${JSON.stringify({
      type: 'data-agent-run',
      id: `${event.runId}:${event.seq}`,
      data: event,
    })}\n\n`)
  }, resumedPublicSnapshot)
  let terminalSnapshotPersisted = false
  const persistTerminalSnapshot = () => {
    if (!jobContext || terminalSnapshotPersisted) return
    const agentRun = publicProjector.getSnapshot()
    if (!['cancelled', 'failed'].includes(agentRun.status)) return
    const content = agentRun.summaryMarkdown ?? ''
    const persisted = workspaceId
      ? appendWorkspaceMessage(workspaceId, conversationId, 'assistant', content, undefined, undefined, undefined, undefined, assistantMessageId, agentRun)
      : appendMessage(conversationId, 'assistant', content, undefined, undefined, undefined, undefined, assistantMessageId, agentRun)
    if (!persisted) throw new Error(`Conversation ${conversationId} was not found`)
    terminalSnapshotPersisted = true
  }
  effectiveRuntimeExtensions.push(publicProjector.extension)
  if (jobContext) {
    effectiveRuntimeExtensions.push({
      name: 'task-runtime-event-log',
      onEvent: event => {
        jobContext.emit('log', {
          channel: 'agent.runtime',
          event: event as unknown as JsonValue,
        })
      },
    })
  }

  // 注册新的活跃循环（占位，后续填充 running promise）
  const loopPromise = new Promise<void>((resolve, reject) => {
    reportStartupPhase('loop.invoked')
    void runAgentLoop({
      messages: coreMessages,
      systemPrompt,
      buildSystemPrompt,
      prompt: userPrompt,
      messageId,
      conversationId,
      securityContext,
      agentName,
      runtimeExtensions: effectiveRuntimeExtensions,
      onStartupPhase: reportStartupPhase,
      throwOnError: Boolean(jobContext),
      abortSignal: jobContext?.signal,
      resumeState,
      onStepCommitted: jobContext ? (state) => {
        durableStepIndex = state.nextStepIndex
        jobContext.checkpoint('agent_loop_state', JSON.parse(JSON.stringify(state)) as JsonValue)
        jobContext.checkpoint('agent_public_snapshot', publicProjector.getSnapshot() as unknown as JsonValue)
      } : undefined,
      onChunk: (data: string) => {
        if (jobContext) {
          const value = data.startsWith('data: ') ? data.slice(6).trim() : data
          let chunk: unknown = value
          try { chunk = JSON.parse(value) } catch { /* retain text */ }
          jobContext.emit('log', { channel: 'agent.stream', chunk: chunk as any })
        } else emitLoopEvent(conversationId, data)
      },
      onDone: () => {
        persistTerminalSnapshot()
        if (!jobContext) resolve()
      },
      onFinish: async (event) => {
        const { text, steps } = event
        // 从所有步骤里提取工具调用记录（input + output 配对）+ per-step usage
        const toolCalls: ToolCallRecord[] = []
        const stepUsages: StepUsageRecord[] = []
        for (const step of steps) {
          for (const call of step.toolCalls) {
            const result = step.toolResults.find(
              (r: { toolCallId: string }) => r.toolCallId === call.toolCallId
            )
            const isError = (result as { isError?: boolean } | undefined)?.isError ?? false
            toolCalls.push({
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input: (call as { input?: unknown }).input,
              output: (result as { output?: unknown } | undefined)?.output,
              isError,
              errorText: isError ? String((result as { output?: unknown } | undefined)?.output ?? '') : undefined,
            })
          }
          // 收集该步骤的 token 用量 + 工具名列表
          const stepToolNames = step.toolCalls.map((c: { toolName: string }) => c.toolName)
          stepUsages.push({
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
            cacheReadTokens: step.usage.cacheReadTokens,
            cacheWriteTokens: step.usage.cacheWriteTokens,
            noCacheTokens: step.usage.noCacheTokens,
            toolNames: stepToolNames.length > 0 ? stepToolNames : undefined,
            progressText: stepToolNames.length > 0 ? step.progressText : undefined,
          })
        }

        // 持久化：最后一条 user 消息 + assistant 回复（含工具调用记录）
        const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
        const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
        if (userText && !jobContext) {
          if (workspaceId) {
            appendWorkspaceMessage(workspaceId, conversationId, 'user', userText)
          } else {
            appendMessage(conversationId, 'user', userText)
          }
        }
        if (text || toolCalls.length > 0) {
          const usage = event.usage
            ? {
                inputTokens: event.usage.inputTokens ?? undefined,
                outputTokens: event.usage.outputTokens ?? undefined,
                cacheReadTokens: event.usage.cacheReadTokens ?? undefined,
                cacheWriteTokens: event.usage.cacheWriteTokens ?? undefined,
                noCacheTokens: event.usage.noCacheTokens ?? undefined,
              }
            : undefined
          const finalUsage: AgentRunUsage = {
            inputTokens: event.usage?.inputTokens ?? 0,
            outputTokens: event.usage?.outputTokens ?? 0,
            totalTokens: (event.usage?.inputTokens ?? 0) + (event.usage?.outputTokens ?? 0),
            ...(event.usage?.cacheReadTokens === undefined ? {} : { cacheReadTokens: event.usage.cacheReadTokens }),
            ...(event.usage?.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: event.usage.cacheWriteTokens }),
            ...(event.usage?.noCacheTokens === undefined ? {} : { noCacheTokens: event.usage.noCacheTokens }),
            stepCount: event.totalSteps ?? steps.length,
            toolCallCount: event.totalToolCalls ?? toolCalls.length,
            toolErrorCount: event.totalToolErrors ?? toolCalls.filter(call => call.isError).length,
            durationMs: event.durationMs ?? 0,
            completeness: 'complete',
          }
          const persistAssistant = (agentRun: AgentRunSnapshot) => {
            const persisted = workspaceId
              ? appendWorkspaceMessage(workspaceId, conversationId, 'assistant', text, toolCalls.length > 0 ? toolCalls : undefined, usage, stepUsages.length > 0 ? stepUsages : undefined, undefined, jobContext ? assistantMessageId : undefined, agentRun)
              : appendMessage(conversationId, 'assistant', text, toolCalls.length > 0 ? toolCalls : undefined, usage, stepUsages.length > 0 ? stepUsages : undefined, undefined, jobContext ? assistantMessageId : undefined, agentRun)
            if (!persisted) throw new Error(`Conversation ${conversationId} was not found`)
            terminalSnapshotPersisted = true
          }
          await publicProjector.finalize(text, finalUsage, persistAssistant)
        }

        if (jobContext) {
          jobContext.checkpoint('assistant_message_committed', { messageId: assistantMessageId, toolCallCount: toolCalls.length })
          jobContext.addArtifact({ kind: 'conversation.message', mediaType: 'application/json', name: 'assistant-message', uri: `manta://conversations/${conversationId}/messages/${assistantMessageId}`, metadata: { conversationId, messageId: assistantMessageId } })
        }

        logManager.closeConversation(conversationId)
      },
      onError: async (errorText: string) => {
        logger.error(`AgentLoop 异常: ${errorText.slice(0, 80)}`, undefined, {
          conversationId,
          messageId,
          agentName,
          errorText: errorText.slice(0, 200),
        }, ['agent', 'loop', 'error'])

        // 根据是否有 workspaceId 选择正确的存储函数
        const appendMsg = workspaceId
          ? (role: 'user' | 'assistant', content: string) =>
              appendWorkspaceMessage(workspaceId, conversationId, role, content)
          : (role: 'user' | 'assistant', content: string) =>
              appendMessage(conversationId, role, content)

        const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
        const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
        if (userText && !jobContext) {
          appendMsg('user', userText)
        }
        if (!jobContext) appendMsg('assistant', errorText)

        logManager.closeConversation(conversationId)
      },
    }).then(() => {
      if (jobContext) resolve()
    }, reject)
  })

  if (!jobContext) registerLoop(conversationId, loopPromise)

  return { isNew: true, completion: loopPromise, assistantMessageId }
}

interface CompleteIntentGateTurnOptions {
  conversationId: string
  workspaceId?: string
  userPrompt: string
  messageId: string
  assistantMessageId: string
  response: string
  jobContext?: JobExecutorContext
}

/**
 * Complete a preflight-only turn without entering the Agent Loop. This is the
 * hard boundary that guarantees clarification and plan-proposal turns cannot
 * call tools.
 */
async function completeIntentGateTurn(
  options: CompleteIntentGateTurnOptions,
): Promise<StreamChatResult> {
  const finish = async () => {
    if (!options.jobContext && options.userPrompt) {
      const user = options.workspaceId
        ? appendWorkspaceMessage(options.workspaceId, options.conversationId, 'user', options.userPrompt, undefined, undefined, undefined, undefined, options.messageId)
        : appendMessage(options.conversationId, 'user', options.userPrompt, undefined, undefined, undefined, undefined, options.messageId)
      if (!user) throw new Error(`Conversation ${options.conversationId} was not found`)
    }

    const assistant = options.workspaceId
      ? appendWorkspaceMessage(options.workspaceId, options.conversationId, 'assistant', options.response, undefined, undefined, undefined, undefined, options.assistantMessageId)
      : appendMessage(options.conversationId, 'assistant', options.response, undefined, undefined, undefined, undefined, options.assistantMessageId)
    if (!assistant) throw new Error(`Conversation ${options.conversationId} was not found`)

    const textId = `${options.assistantMessageId}:intent`
    const chunks: JsonValue[] = [
      { type: 'text-start', id: textId },
      { type: 'text-delta', id: textId, delta: options.response },
      { type: 'text-end', id: textId },
      { type: 'finish', finishReason: 'stop' },
    ]
    for (const chunk of chunks) {
      if (options.jobContext) {
        options.jobContext.emit('log', { channel: 'agent.stream', chunk })
      } else {
        emitLoopEvent(options.conversationId, `data: ${JSON.stringify(chunk)}\n\n`)
      }
    }

    if (options.jobContext) {
      options.jobContext.checkpoint('assistant_message_committed', {
        messageId: options.assistantMessageId,
        toolCallCount: 0,
      })
      options.jobContext.addArtifact({
        kind: 'conversation.message',
        mediaType: 'application/json',
        name: 'assistant-message',
        uri: `manta://conversations/${options.conversationId}/messages/${options.assistantMessageId}`,
        metadata: {
          conversationId: options.conversationId,
          messageId: options.assistantMessageId,
          intentGate: true,
        },
      })
    }
    logManager.closeConversation(options.conversationId)
  }

  if (options.jobContext) {
    await finish()
    return {
      isNew: true,
      completion: Promise.resolve(),
      assistantMessageId: options.assistantMessageId,
    }
  }

  let resolveCompletion!: () => void
  let rejectCompletion!: (error: unknown) => void
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  registerLoop(options.conversationId, completion)
  queueMicrotask(() => {
    void finish().then(resolveCompletion, rejectCompletion)
  })
  return { isNew: true, completion, assistantMessageId: options.assistantMessageId }
}

type DurableApprovalInput = { approvalId?: string; decision?: 'approve' | 'deny' }

async function handleDurableApproval(
  context: JobExecutorContext,
  approval: SecurityApprovalRequest,
  stepIndex: number,
  readInput: () => DurableApprovalInput | undefined,
  writeInput: (value: DurableApprovalInput | undefined) => void,
): Promise<boolean> {
  const approvalId = `approval-${createHash('sha256').update(JSON.stringify({ jobId: context.job.id, stepIndex, approval })).digest('hex').slice(0, 32)}`
  const checkpointName = `agent_approval:${approvalId}`
  const resolved = context.readCheckpoint<{ decision: 'approve' | 'deny' }>(checkpointName)
  if (resolved) return resolved.decision === 'approve'

  const provided = readInput()
  if (provided) {
    writeInput(undefined)
    if (provided.approvalId !== approvalId || !provided.decision) {
      throw Object.assign(new Error(`Approval input does not match ${approvalId}`), { code: 'INVALID_APPROVAL_INPUT' })
    }
    context.checkpoint(checkpointName, { decision: provided.decision })
    approvalManager.respondToRequest(approvalId, provided.decision)
    return provided.decision === 'approve'
  }

  const request = {
    id: approvalId,
    jobId: context.job.id,
    type: approval.type,
    requestedBy: context.job.id,
    stepIndex,
    createdAt: Date.now(),
    ...(approval.path ? { path: approval.path } : {}),
    ...(approval.command ? { command: approval.command } : {}),
  } as const
  approvalManager.createRequest(approval.type, context.job.id, approval.path, approval.command, approvalId)
  context.checkpoint('agent_pending_approval', request)
  return context.waitForInput(request)
}
/* AI end: 流式聊天核心处理逻辑结束 */
