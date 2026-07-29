/**
 * Agent Run 上下文快照。
 *
 * System Prompt 和工具定义在 Conversation 首次执行时冻结并跨用户回合复用。
 * Agent Loop 内只有 Messages 会持续追加、裁剪和压缩，避免重新读取项目指令、
 * Memory 或重建工具 Schema。
 */
export interface AgentRunContextSnapshot {
  readonly systemPrompt: string
  readonly tools: Readonly<Record<string, unknown>>
}

export function createAgentRunContextSnapshot(
  systemPrompt: string,
  tools: Record<string, unknown>,
): AgentRunContextSnapshot {
  return Object.freeze({
    systemPrompt,
    tools: Object.freeze({ ...tools }),
  })
}
