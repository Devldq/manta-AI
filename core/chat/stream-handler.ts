/* AI start: 流式聊天核心处理逻辑 */
import { streamText, type CoreMessage } from 'ai'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'
import { conversationTools } from '@/core/conversation/tools'
import { fsTools } from '@/core/conversation/fs-tools'
import { appendMessage } from '@/core/conversation/store'
import { readAgentSoul } from './agent-soul'
import { parseMessagesToCore, type UIMessage } from './message-parser'

/** 流式聊天选项 */
export interface StreamChatOptions {
  messages: UIMessage[]
  agentName: string
  conversationId: string
}

/** 执行流式聊天并返回流式响应 */
export async function streamChat({ messages, agentName, conversationId }: StreamChatOptions) {
  // 检查 LLM 配置
  const llmConfig = getLLMConfig()
  if (!llmConfig.apiKey && llmConfig.provider !== 'ollama' && llmConfig.provider !== 'lm-studio') {
    throw new Error('LLM 未配置 API Key，请前往 Settings → AI 模型 进行配置')
  }

  // 读取 agent 的 SOUL.md 作为 system prompt
  const systemPrompt = readAgentSoul(agentName)

  // 获取 AI SDK 模型
  const model = await getAISDKModel()

  // 解析消息格式
  const coreMessages = parseMessagesToCore(messages)

  // 执行流式生成
  const result = streamText({
    model,
    system: systemPrompt ?? undefined,
    messages: coreMessages,
    tools: { ...conversationTools, ...fsTools },
    temperature: llmConfig.temperature ?? 0.7,
    onFinish: async ({ text }) => {
      // 持久化：最后一条 user 消息 + assistant 回复
      const lastUserMsg = [...coreMessages].reverse().find((m) => m.role === 'user')
      if (lastUserMsg?.content) {
        appendMessage(conversationId, 'user', lastUserMsg.content)
      }
      if (text) {
        appendMessage(conversationId, 'assistant', text)
      }
    },
  })

  // 返回流式响应
  return result.toUIMessageStreamResponse()
}
/* AI end: 流式聊天核心处理逻辑结束 */
