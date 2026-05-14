/* Agent 执行循环 — 基于 streamText 单次调用，原生多步工具调用 + 实时流式状态 */
import { streamText, type ModelMessage, type OnFinishEvent } from 'ai'
import { getAISDKModel } from '@/core/llm/ai-sdk-provider'
import { getLLMConfig } from '@/core/llm/config-store'
import { conversationTools } from '@/core/conversation/tools'
import { fsTools } from '@/core/conversation/fs-tools'
import { ccTools } from '@/core/conversation/cc-tools'

/** 最大工具调用步数（之后强制输出文字） */
const MAX_TOOL_STEPS = 18

/** Token 预算上限（累计输出 token 超过此值则停止） */
const MAX_OUTPUT_TOKENS = 8000

const ALL_TOOLS = { ...conversationTools, ...fsTools, ...ccTools }

/** Agent Loop 选项 */
export interface AgentLoopOptions {
  messages: ModelMessage[]
  systemPrompt?: string | null
  abortSignal?: AbortSignal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onFinish?: (event: OnFinishEvent<any>) => Promise<void> | void
}

/**
 * 重复调用检测：检查最后 2 步是否调用了完全相同的工具和参数
 * 如果是，说明模型陷入了循环，强制停止
 */
function repeatDetector({ steps }: { steps: { finishReason: string; toolCalls: { toolName: string; input: unknown }[] }[] }): boolean {
  if (steps.length < 2) return false
  const last = steps[steps.length - 1]
  const prev = steps[steps.length - 2]

  if (last.finishReason !== 'tool-calls' || prev.finishReason !== 'tool-calls') return false
  if (last.toolCalls.length === 0 || prev.toolCalls.length === 0) return false

  const serialize = (calls: { toolName: string; input: unknown }[]) =>
    JSON.stringify(calls.map((c) => ({ name: c.toolName, input: c.input })))

  return serialize(last.toolCalls) === serialize(prev.toolCalls)
}

/**
 * Token 预算检测：累计输出 token 超过阈值则停止
 */
function tokenBudgetGuard({ steps }: { steps: { usage?: { outputTokens?: number } }[] }): boolean {
  const totalOutput = steps.reduce((sum, s) => sum + (s.usage?.outputTokens ?? 0), 0)
  return totalOutput >= MAX_OUTPUT_TOKENS
}

/**
 * 执行 Agent Loop：
 * - 使用 streamText 原生 multi-step，全程流式推送工具调用状态和文本输出
 * - 退出条件：步数上限 | Token 预算 | 重复调用检测 | AbortSignal
 */
export async function runAgentLoop({ messages, systemPrompt, abortSignal, onFinish }: AgentLoopOptions) {
  const llmConfig = getLLMConfig()
  const model = await getAISDKModel()

  return streamText({
    model,
    system: systemPrompt ?? undefined,
    tools: ALL_TOOLS,
    temperature: llmConfig.temperature ?? 0.7,
    messages,
    abortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stopWhen: [repeatDetector as any, tokenBudgetGuard as any],
    // 当步数达到上限时，禁用工具强制模型输出文字总结
    prepareStep: ({ steps }) => {
      if (steps.length >= MAX_TOOL_STEPS) {
        return { toolChoice: 'none' }
      }
      return {}
    },
    onFinish,
  })
}
