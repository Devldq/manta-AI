/* AI start: 流式聊天核心处理逻辑 */
import { getLLMConfig } from '@/core/llm/config-store'
import { appendMessage } from '@/core/conversation/store'
import type { ToolCallRecord, StepUsageRecord } from '@/core/conversation/types'
import { readAgentSoul } from '../context/agent-soul'
import {
  buildSystemPromptWithStats,
  createMantaPromptBuilder,
  type PromptContext,
} from '../context/prompt-builder'
import { getToolRegistry } from '@/core/tool-registry/mcp-setup'
import { parseMessagesToCore, type UIMessage } from './message-parser'
import { runAgentLoop } from './agent-loop'
import { getActiveLoop, registerLoop, emitLoopEvent } from './loop-registry'
import { logger, logManager } from '@/core/log'

/** 流式聊天选项 */
export interface StreamChatOptions {
  messages: UIMessage[]
  agentName: string
  conversationId: string
}

/** 启动结果的返回类型 */
export interface StreamChatResult {
  /** 是否是新启动的循环（true）还是已有活跃循环（false） */
  isNew: boolean
}

/**
 * 启动流式聊天 Agent Loop（如果该会话已有活跃循环则不重复启动）
 * Loop 与 HTTP 连接完全解耦，通过 LoopRegistry 广播事件
 */
export async function startAgentLoop({ messages, agentName, conversationId }: StreamChatOptions): Promise<StreamChatResult> {
  // 如果已有活跃循环，不重复启动
  if (getActiveLoop(conversationId)) {
    return { isNew: false }
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
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // 构建 system prompt builder（每步 API 调用时重新 build，确保新存记忆立即可见）
  const soulPrompt = readAgentSoul(agentName)
  const cwd = process.cwd()
  const promptBuilder = createMantaPromptBuilder({ cwd, soulPrompt })

  // 每步重建 system prompt 的闭包：memoryContext pipe 内部实时读 MemoryStore
  const buildSystemPrompt = async (): Promise<string> => {
    const registry = await getToolRegistry()
    const ctx: PromptContext = {
      toolCount: registry.getAll().length,
      deferredToolSummary: registry.getDeferredToolSummary(),
      sessionMessageCount: messages.length,
      sessionId: conversationId,
    }
    return promptBuilder.build(ctx)
  }

  // 首次构建获取初始 system prompt + 统计
  const { prompt: systemPrompt, stats: pipeStats } = await buildSystemPromptWithStats({
    soulPrompt,
    cwd,
    conversationId,
    messageId,
  })

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
    systemContent: systemPrompt,
    hasSoul: !!soulPrompt,
    soulLength: soulPrompt?.length ?? 0,
    extra: {
      pipePieces: pipeStats.filter(s => s.enabled).map(s => s.name),
      pipeTokens: Math.ceil(systemPrompt.length / 2.5),
    },
  })

  // 解析消息格式
  const coreMessages = parseMessagesToCore(messages)

  // 注册新的活跃循环（占位，后续填充 running promise）
  const loopPromise = new Promise<void>((resolve) => {
    runAgentLoop({
      messages: coreMessages,
      systemPrompt,
      buildSystemPrompt,
      prompt: userPrompt,
      messageId,
      conversationId,
      onChunk: (data: string) => emitLoopEvent(conversationId, data),
      onDone: () => resolve(),
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
          })
        }

        // 持久化：最后一条 user 消息 + assistant 回复（含工具调用记录）
        const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
        const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
        if (userText) {
          appendMessage(conversationId, 'user', userText)
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
          appendMessage(conversationId, 'assistant', text, toolCalls.length > 0 ? toolCalls : undefined, usage, stepUsages.length > 0 ? stepUsages : undefined)
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

        const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
        const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
        if (userText) {
          appendMessage(conversationId, 'user', userText)
        }
        appendMessage(conversationId, 'assistant', errorText)

        logManager.closeConversation(conversationId)
      },
    })
  })

  registerLoop(conversationId, loopPromise)

  return { isNew: true }
}
/* AI end: 流式聊天核心处理逻辑结束 */