/* AI start: 流式聊天核心处理逻辑 */
import { getLLMConfig } from '@/core/llm/config-store'
import { appendMessage } from '@/core/conversation/store'
import type { ToolCallRecord, StepUsageRecord } from '@/core/conversation/types'
import { readAgentSoul } from '../context/agent-soul'
import { buildSystemPrompt } from '../context/system-prompt'
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
    logger.info(`会话 ${conversationId} 已有活跃循环，跳过启动`, undefined, ['chat', 'loop-existing'])
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

  logger.system('ChatStream', `开始处理会话 ${conversationId}`, 'pending', {
    conversationId,
    messageId,
    agentName,
    prompt: userPrompt,
    model: modelInfo.model,
    provider: modelInfo.provider,
    messageCount: messages.length,
  })

  // 构建 system prompt（融合 Claude Code 设计理念的模块化组合）
  const soulPrompt = readAgentSoul(agentName)
  const systemPrompt = await buildSystemPrompt({ soulPrompt, cwd: process.cwd() })

  logger.info(`会话 ${conversationId} soulPrompt`, {
    conversationId,
    messageId,
    hasSoul: !!soulPrompt,
    soulLength: soulPrompt?.length ?? 0,
    soulContent: soulPrompt || undefined,
  }, ['chat', 'prompt'])
  logger.info(`会话 ${conversationId} systemPrompt 已构建`, {
    conversationId,
    messageId,
    systemLength: systemPrompt.length,
    hasSoul: !!soulPrompt,
    systemContent: systemPrompt,
  }, ['chat', 'prompt'])

  // 解析消息格式
  const coreMessages = parseMessagesToCore(messages)

  // 注册新的活跃循环（占位，后续填充 running promise）
  const loopPromise = new Promise<void>((resolve) => {
    runAgentLoop({
      messages: coreMessages,
      systemPrompt,
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

        logger.system('ChatStream', `会话 ${conversationId} 处理完成`, 'success', {
          conversationId,
          messageId,
          agentName,
          prompt: userPrompt,
          model: modelInfo.model,
          provider: modelInfo.provider,
          stepsCount: steps.length,
          toolCallsCount: toolCalls.length,
          responseLength: text.length,
        })
        logManager.closeConversation(conversationId)
      },
      onError: async (errorText: string) => {
        logger.system('ChatStream', `会话 ${conversationId} 处理出错`, 'failure', {
          conversationId,
          messageId,
          agentName,
          prompt: userPrompt,
          model: modelInfo.model,
          provider: modelInfo.provider,
          errorText: errorText.slice(0, 200),
        })

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