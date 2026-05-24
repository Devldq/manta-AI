/* AI start: 流式聊天核心处理逻辑 */
import { getLLMConfig } from '@/core/llm/config-store'
import { appendMessage } from '@/core/conversation/store'
import type { ToolCallRecord } from '@/core/conversation/types'
import { readAgentSoul } from './agent-soul'
import { buildSystemPrompt } from './system-prompt'
import { parseMessagesToCore, type UIMessage } from './message-parser'
import { runAgentLoop } from './agent-loop'
import { logger } from '@/core/log'

/** 流式聊天选项 */
export interface StreamChatOptions {
  messages: UIMessage[]
  agentName: string
  conversationId: string
  abortSignal?: AbortSignal
}

/** 执行流式聊天并返回流式响应 */
export async function streamChat({ messages, agentName, conversationId, abortSignal }: StreamChatOptions) {
  // 检查 LLM 配置
  const llmConfig = getLLMConfig()
  if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
    throw new Error('LLM 未配置 API Key，请前往 Settings → AI 模型 进行配置')
  }

  logger.system('ChatStream', `开始处理会话 ${conversationId}`, 'pending', {
    conversationId,
    agentName,
    messageCount: messages.length,
  })

  // 构建 system prompt（融合 Claude Code 设计理念的模块化组合）
  const soulPrompt = readAgentSoul(agentName)
  const systemPrompt = buildSystemPrompt({ soulPrompt, cwd: process.cwd() })

  // 解析消息格式
  const coreMessages = parseMessagesToCore(messages)

  // 执行 Agent Loop（返回 Response 对象）
  const response = await runAgentLoop({
    messages: coreMessages,
    systemPrompt,
    abortSignal,
    conversationId,
    onFinish: async (event) => {
      const { text, steps } = event
      // 从所有步骤里提取工具调用记录（input + output 配对）
      const toolCalls: ToolCallRecord[] = []
      for (const step of steps) {
        for (const call of step.toolCalls) {
          // 找到对应的 toolResult
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
      }

      // 持久化：最后一条 user 消息 + assistant 回复（含工具调用记录）
      const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
      const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
      if (userText) {
        appendMessage(conversationId, 'user', userText)
      }
      if (text || toolCalls.length > 0) {
        // AI: 使用 event.usage 而非 event.totalUsage（P1-3 修复）
        const usage = event.usage
          ? { inputTokens: event.usage.inputTokens ?? undefined, outputTokens: event.usage.outputTokens ?? undefined }
          : undefined
        appendMessage(conversationId, 'assistant', text, toolCalls.length > 0 ? toolCalls : undefined, usage)
      }

      logger.system('ChatStream', `会话 ${conversationId} 处理完成`, 'success', {
        conversationId,
        stepsCount: steps.length,
        toolCallsCount: toolCalls.length,
        responseLength: text.length,
      })
    },
    /** 错误时回调：保存用户消息和错误信息到对话历史 */
    onError: async (errorText: string) => {
      logger.system('ChatStream', `会话 ${conversationId} 处理出错`, 'failure', {
        conversationId,
        errorText: errorText.slice(0, 200),
      })

      // 保存用户消息
      const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
      const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
      if (userText) {
        appendMessage(conversationId, 'user', userText)
      }
      // 保存错误回复
      appendMessage(conversationId, 'assistant', errorText)
    },
  })

  // 直接返回 Response（runAgentLoop 已构建好 SSE 流）
  return response
}
/* AI end: 流式聊天核心处理逻辑结束 */