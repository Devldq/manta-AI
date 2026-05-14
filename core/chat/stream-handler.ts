/* AI start: 流式聊天核心处理逻辑 */
import { getLLMConfig } from '@/core/llm/config-store'
import { appendMessage } from '@/core/conversation/store'
import type { ToolCallRecord } from '@/core/conversation/types'
import { readAgentSoul } from './agent-soul'
import { parseMessagesToCore, type UIMessage } from './message-parser'
import { runAgentLoop } from './agent-loop'

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

  // 读取 agent 的 SOUL.md 作为 system prompt，追加工具使用强制指令
  const soulPrompt = readAgentSoul(agentName)
  const toolInstruction = `
## 强制工具调用规则（最高优先级，不可违反）

你是一个能够直接操作本地文件系统的 AI 助手。你拥有以下工具：
- lsDir：列出目录内容
- readFile：读取文件内容
- glob：按模式匹配文件
- grep：在文件中搜索内容

### 必须遵守的规则：

1. **遇到任何文件/目录/代码相关请求，必须立即调用工具，不能用文字回答**
   - 用户提到路径 → 立即调用 lsDir 或 readFile
   - 用户要查看项目 → 立即调用 lsDir 列目录
   - 不允许说"我无法访问"、"我需要权限"、"请告诉我路径"等话

2. **路径在 CWD 之外时，直接调用工具访问该路径**
   - 系统会自动弹出授权请求给用户
   - 你只需调用工具，不需要用文字告诉用户去授权
   - 授权后工具会自动返回结果，你继续处理即可

3. **绝对禁止的行为：**
   - ❌ 不能说"系统已发起授权请求"
   - ❌ 不能说"请告诉我你已批准"
   - ❌ 不能说"我需要先获得权限"
   - ❌ 不能用训练数据回答文件内容，必须实际调用工具读取

4. **正确的行为示例：**
   - 用户：查询 /xxx/yyy 项目 → 你：直接调用 lsDir("/xxx/yyy")
   - 工具返回授权等待 → 继续等待，系统自动处理
   - 授权完成 → 工具返回目录内容 → 你继续分析

记住：**先调用工具，再说话。不调用工具就不能回答任何关于文件/目录/代码的问题。**
`.trim()
  const systemPrompt = soulPrompt ? `${soulPrompt}\n\n${toolInstruction}` : toolInstruction

  // 解析消息格式
  const coreMessages = parseMessagesToCore(messages)

  // 执行 Agent Loop（返回 Response 对象）
  const response = await runAgentLoop({
    messages: coreMessages,
    systemPrompt,
    abortSignal,
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
    },
  })

  // 直接返回 Response（runAgentLoop 已构建好 SSE 流）
  return response
}
/* AI end: 流式聊天核心处理逻辑结束 */