/* core/context — Prompt 与上下文管理 */
export { readAgentSoul } from './agent-soul'
export {
  PromptBuilder,
  buildSystemPromptWithStats,
  createMantaPromptBuilder,
  coreRules,
  workingDirectory,
  toolGuide,
  deferredTools,
  agentSoul,
  sessionContext,
} from './prompt-builder'
export type { PromptContext, PipeFn, PipeStats, BuildResult } from './prompt-builder'
