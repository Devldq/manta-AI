import { randomUUID } from 'node:crypto'
import { generateText, type ModelMessage } from 'ai'
import { z } from 'zod'
import { getAISDKModel } from '@llm/ai-sdk-provider'

export const INTENT_GATE_CONTEXT_KEY = 'intentGate'
export const INTENT_CONFIRMATION_CONFIDENCE = 0.85

const IntentActionSchema = z.enum([
  'conversation',
  'answer',
  'inspect',
  'modify',
  'execute',
  'external_action',
  'manage',
])

const IntentRiskSchema = z.enum([
  'none',
  'read_only',
  'local_write',
  'external_write',
  'destructive',
])

export const IntentUnderstandingSchema = z.object({
  requestType: z.enum(['conversation', 'information', 'task']),
  goal: z.string().trim().min(1).max(1_000),
  desiredOutcome: z.string().trim().min(1).max(1_000),
  target: z.string().trim().max(1_000),
  ambiguity: z.enum(['clear', 'needs_clarification']),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(6),
  questions: z.array(z.string().trim().min(1).max(500)).max(6),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(6),
  pendingPlanRelation: z.enum(['none', 'confirm', 'revise', 'reject', 'discuss']),
})

export type IntentUnderstanding = z.infer<typeof IntentUnderstandingSchema>

export const IntentAnalysisSchema = z.object({
  decision: z.enum(['respond', 'clarify', 'propose', 'execute']),
  executionMode: z.enum(['none', 'direct', 'confirmed_plan']),
  requestType: z.enum(['conversation', 'information', 'task']),
  complexity: z.enum(['simple', 'complex']),
  action: IntentActionSchema,
  risk: IntentRiskSchema,
  goal: z.string().trim().min(1).max(1_000),
  summary: z.string().trim().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(6),
  questions: z.array(z.string().trim().min(1).max(500)).max(6),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(6),
  plan: z.array(z.string().trim().min(1).max(700)).max(10),
  directResponse: z.string().trim().max(4_000),
  pendingPlanDisposition: z.enum(['keep', 'replace', 'clear']),
  understanding: IntentUnderstandingSchema.optional(),
})

export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>

export const PendingIntentPlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  goal: z.string().min(1),
  action: IntentActionSchema,
  risk: IntentRiskSchema,
  assumptions: z.array(z.string()),
  steps: z.array(z.string()).min(1),
  sourceMessageId: z.string().min(1),
  createdAt: z.string().datetime(),
})

export type PendingIntentPlan = z.infer<typeof PendingIntentPlanSchema>

export const IntentGateStateSchema = z.object({
  schemaVersion: z.literal(1),
  pendingPlan: PendingIntentPlanSchema.optional(),
})

export type IntentGateState = z.infer<typeof IntentGateStateSchema>

export interface AnalyzeIntentOptions {
  messages: ModelMessage[]
  userPrompt: string
  pendingPlan?: PendingIntentPlan
  agentName?: string
  abortSignal?: AbortSignal
}

/** Understand the user's purpose first, then plan from that frozen understanding. */
export async function analyzeUserIntent(options: AnalyzeIntentOptions): Promise<IntentAnalysis> {
  const model = await getAISDKModel()
  const conversation = recentConversation(options.messages)
  const pendingPlan = options.pendingPlan
    ? JSON.stringify(options.pendingPlan, null, 2)
    : 'none'

  const understandingResult = await generateText({
    model,
    system: INTENT_UNDERSTANDING_SYSTEM_PROMPT,
    prompt: buildIntentUnderstandingPrompt({
      agentName: options.agentName,
      pendingPlan,
      conversation,
      userPrompt: options.userPrompt,
    }),
    temperature: 0.1,
    maxOutputTokens: 1_000,
    abortSignal: options.abortSignal,
  })
  const understanding = parseStructuredText(
    understandingResult.text,
    IntentUnderstandingSchema,
    'intent understanding',
  )

  const planningResult = await generateText({
    model,
    system: INTENT_PLANNING_SYSTEM_PROMPT,
    prompt: buildIntentPlanningPrompt(understanding, pendingPlan, options.userPrompt),
    temperature: 0.1,
    maxOutputTokens: 1_500,
    abortSignal: options.abortSignal,
  })
  const planned = groundIntentPlan(
    parseStructuredText(planningResult.text, IntentAnalysisSchema, 'intent plan'),
    understanding,
  )

  return enforceIntentGate(
    planned,
    options.pendingPlan,
    options.userPrompt,
  )
}

const INTENT_UNDERSTANDING_SYSTEM_PROMPT = `You are Manta's intent-understanding stage. You have no tools.

Analyze only what the user is trying to achieve. Do not solve the request, choose tools, name commands, inspect files, design implementation steps, or produce an execution plan.

Infer obvious context when it is safe. Mark needs_clarification only when missing information could materially change the target or desired outcome and no reasonable reversible assumption permits useful progress. A broad product goal is not ambiguous merely because the user did not provide a complete specification; the planning stage can start with discovery and an assumed MVP. A clear request must remain clear.

Use the language of the latest user message. Return JSON only, with exactly:
{"requestType":"conversation|information|task","goal":"...","desiredOutcome":"...","target":"... or empty string","ambiguity":"clear|needs_clarification","confidence":0.0,"missingInformation":[],"questions":[],"assumptions":[],"pendingPlanRelation":"none|confirm|revise|reject|discuss"}`

const INTENT_PLANNING_SYSTEM_PROMPT = `You are Manta's intent-planning stage. You have no tools and must not perform the task.

The supplied intent understanding is the source of truth. Do not reinterpret or expand its goal. Decide the lightest safe next step and create an outcome-oriented plan only after the goal is understood.

Never name tools, APIs, shell commands, function names, or files to inspect unless the user explicitly named them. Plan steps describe outcomes and verification checkpoints, not tool selection.

Decision rules:
- "respond": only greetings, acknowledgements, or casual conversation where directResponse is the complete response.
- "clarify": only when the understanding says critical information is missing and no reasonable reversible assumption lets the Agent make useful progress. Reuse its focused questions.
- "execute"/"direct": work the Agent can plan and begin autonomously with risk no higher than local_write. Complexity, breadth, or plan length alone are not reasons to ask for confirmation. Use explicit assumptions for choices that are safe and reversible.
- "propose": only when the user asked for a plan without execution, or when execution needs a materially consequential choice that cannot be resolved by a safe reversible assumption.
- "execute"/"confirmed_plan": only an unambiguous confirmation of the exact pending plan.

Never directly execute external_write or destructive work. Confirmation does not broaden scope or bypass normal approval controls.

Use the language of the latest user message. Return JSON only, with exactly:
{"decision":"respond|clarify|propose|execute","executionMode":"none|direct|confirmed_plan","requestType":"conversation|information|task","complexity":"simple|complex","action":"conversation|answer|inspect|modify|execute|external_action|manage","risk":"none|read_only|local_write|external_write|destructive","goal":"...","summary":"...","confidence":0.0,"missingInformation":[],"questions":[],"assumptions":[],"plan":[],"directResponse":"","pendingPlanDisposition":"keep|replace|clear"}`

export function buildIntentUnderstandingPrompt(input: {
  agentName?: string
  pendingPlan: string
  conversation: string
  userPrompt: string
}): string {
  return [
    `<agent>${input.agentName || 'default'}</agent>`,
    `<pending_plan>${input.pendingPlan}</pending_plan>`,
    `<recent_conversation>${input.conversation}</recent_conversation>`,
    `<latest_user_message>${input.userPrompt.slice(0, 8_000)}</latest_user_message>`,
    'Identify the user purpose only. Return JSON and do not plan actions or tools.',
  ].join('\n')
}

export function buildIntentPlanningPrompt(
  understanding: IntentUnderstanding,
  pendingPlan: string,
  userPrompt: string,
): string {
  return [
    `<intent_understanding>${JSON.stringify(understanding, null, 2)}</intent_understanding>`,
    `<pending_plan>${pendingPlan}</pending_plan>`,
    `<latest_user_message>${userPrompt.slice(0, 8_000)}</latest_user_message>`,
    'Create the next-step decision and outcome plan from the supplied understanding. Return JSON only.',
  ].join('\n')
}

export function groundIntentPlan(
  planned: IntentAnalysis,
  understanding: IntentUnderstanding,
): IntentAnalysis {
  const grounded: IntentAnalysis = {
    ...planned,
    requestType: understanding.requestType,
    goal: understanding.goal,
    assumptions: understanding.assumptions,
    understanding,
  }

  if (understanding.ambiguity === 'needs_clarification') {
    return {
      ...grounded,
      decision: 'clarify',
      executionMode: 'none',
      confidence: Math.min(planned.confidence, understanding.confidence),
      missingInformation: understanding.missingInformation,
      questions: understanding.questions,
      plan: [],
      directResponse: '',
      pendingPlanDisposition: planned.pendingPlanDisposition === 'keep' ? 'keep' : 'clear',
    }
  }

  return {
    ...grounded,
    missingInformation: [],
    questions: [],
  }
}

/**
 * Deterministic safety guardrails around the model classification. The model
 * owns the planning decision; code only prevents unsafe direct execution and
 * retains the stricter persisted-plan handshake.
 */
export function enforceIntentGate(
  analysis: IntentAnalysis,
  pendingPlan?: PendingIntentPlan,
  userPrompt = '',
): IntentAnalysis {
  if (analysis.decision === 'execute') {
    if (analysis.executionMode === 'direct') {
      if (canExecuteDirectly(analysis)) {
        return {
          ...analysis,
          missingInformation: [],
          questions: [],
          directResponse: '',
          pendingPlanDisposition: 'clear',
        }
      }
      if (analysis.plan.length > 0) {
        return {
          ...analysis,
          decision: 'propose',
          executionMode: 'none',
          pendingPlanDisposition: 'replace',
          directResponse: '',
        }
      }
      return {
        ...analysis,
        decision: 'clarify',
        executionMode: 'none',
        confidence: Math.min(analysis.confidence, 0.5),
        questions: analysis.questions.length > 0
          ? analysis.questions
          : ['请补充会影响执行结果的关键目标、范围或约束。'],
        pendingPlanDisposition: 'clear',
        directResponse: '',
      }
    }

    if (analysis.executionMode !== 'confirmed_plan' || !pendingPlan) {
      if (analysis.plan.length > 0) {
        return {
          ...analysis,
          decision: 'propose',
          executionMode: 'none',
          pendingPlanDisposition: 'replace',
          directResponse: '',
        }
      }
      return {
        ...analysis,
        decision: 'clarify',
        executionMode: 'none',
        confidence: Math.min(analysis.confidence, 0.5),
        questions: analysis.questions.length > 0
          ? analysis.questions
          : ['请补充会影响执行结果的关键目标、范围或约束。'],
        pendingPlanDisposition: pendingPlan ? 'keep' : 'clear',
        directResponse: '',
      }
    }

    if (
      analysis.confidence < INTENT_CONFIRMATION_CONFIDENCE
      || !hasExplicitPlanConfirmation(userPrompt)
    ) {
      return {
        ...analysis,
        decision: 'clarify',
        executionMode: 'none',
        questions: analysis.questions.length > 0
          ? analysis.questions
          : [/[\u3400-\u9fff]/.test(userPrompt)
              ? '请明确回复“确认执行”，表示按上一版方案执行且不增加或修改范围。'
              : 'Please explicitly reply "Confirm execution" to approve the previous plan without changing its scope.'],
        pendingPlanDisposition: 'keep',
        directResponse: '',
      }
    }

    return {
      ...analysis,
      executionMode: 'confirmed_plan',
      goal: pendingPlan.goal,
      action: pendingPlan.action,
      risk: pendingPlan.risk,
      assumptions: pendingPlan.assumptions,
      plan: pendingPlan.steps,
      missingInformation: [],
      questions: [],
      pendingPlanDisposition: 'clear',
      directResponse: '',
    }
  }

  if (analysis.decision === 'propose') {
    if (analysis.plan.length === 0) {
      return {
        ...analysis,
        decision: 'clarify',
        executionMode: 'none',
        questions: analysis.questions.length > 0
          ? analysis.questions
          : ['请补充你希望最终达到的结果和执行范围。'],
        pendingPlanDisposition: 'clear',
      }
    }
    return { ...analysis, executionMode: 'none', pendingPlanDisposition: 'replace', directResponse: '' }
  }

  if (analysis.decision === 'clarify' && analysis.questions.length === 0) {
    return {
      ...analysis,
      executionMode: 'none',
      questions: ['请补充会影响执行结果的目标、范围或约束信息。'],
      directResponse: '',
    }
  }

  if (analysis.decision === 'respond' && !analysis.directResponse) {
    return {
      ...analysis,
      executionMode: 'none',
      directResponse: analysis.summary,
      pendingPlanDisposition: pendingPlan ? 'keep' : 'clear',
    }
  }

  return { ...analysis, executionMode: 'none' }
}

export function canExecuteDirectly(analysis: IntentAnalysis): boolean {
  const isDirectRequest = analysis.requestType === 'task'
    || (
      analysis.requestType === 'information'
      && analysis.action === 'answer'
      && analysis.risk === 'none'
    )
  return analysis.decision === 'execute'
    && analysis.executionMode === 'direct'
    && isDirectRequest
    && ['none', 'read_only', 'local_write'].includes(analysis.risk)
    && analysis.action !== 'external_action'
    && analysis.missingInformation.length === 0
    && analysis.questions.length === 0
    && analysis.plan.length > 0
}

/**
 * LLM confidence alone is not authorization. Require an explicit, standalone
 * confirmation phrase and reject replies that also revise the plan.
 */
export function hasExplicitPlanConfirmation(userPrompt: string): boolean {
  const normalized = userPrompt
    .trim()
    .toLowerCase()
    .replace(/[。！!,.，；;]+$/g, '')
    .replace(/\s+/g, ' ')
  if (!normalized || normalized.length > 80) return false

  const scopeChange = /(?:但是|不过|另外|同时|新增|增加|修改|调整|改成|不要|只做|先做|除了|顺便|\bbut\b|\bhowever\b|\balso\b|\bexcept\b|\binstead\b|\bchange\b|\badd\b|\bremove\b|\bonly\b)/i
  if (scopeChange.test(normalized)) return false

  return /^(?:我)?(?:明确)?(?:确认(?:执行)?|确认(?:按|按照)(?:上一版|上述|该|这个)?方案执行|同意执行|同意按(?:上一版|上述|该|这个)?方案执行|按(?:上一版|上述|该|这个)?方案执行|可以(?:开始|直接)?执行|开始执行|执行吧)$/.test(normalized)
    || /^(?:i )?(?:explicitly )?(?:confirm(?: execution)?|approve(?: the plan)?|confirm the plan|proceed(?: with the plan)?|go ahead(?: with the plan)?|execute the plan)$/.test(normalized)
}

export function createPendingIntentPlan(
  analysis: IntentAnalysis,
  sourceMessageId: string,
  now = new Date(),
): PendingIntentPlan {
  if (analysis.decision !== 'propose' || analysis.plan.length === 0) {
    throw new Error('Only a proposal with executable steps can become pending')
  }
  return {
    schemaVersion: 1,
    id: randomUUID(),
    goal: analysis.goal,
    action: analysis.action,
    risk: analysis.risk,
    assumptions: analysis.assumptions,
    steps: analysis.plan,
    sourceMessageId,
    createdAt: now.toISOString(),
  }
}

export function createDirectIntentPlan(
  analysis: IntentAnalysis,
  sourceMessageId: string,
  now = new Date(),
): PendingIntentPlan {
  if (!canExecuteDirectly(analysis)) {
    throw new Error('Only a validated direct-execution intent can become an execution plan')
  }
  return {
    schemaVersion: 1,
    id: randomUUID(),
    goal: analysis.goal,
    action: analysis.action,
    risk: analysis.risk,
    assumptions: analysis.assumptions,
    steps: analysis.plan,
    sourceMessageId,
    createdAt: now.toISOString(),
  }
}

export function resolveIntentExecutionPlan(
  analysis: IntentAnalysis,
  pendingPlan: PendingIntentPlan | undefined,
  sourceMessageId: string,
): PendingIntentPlan | undefined {
  if (analysis.decision !== 'execute') return undefined
  if (analysis.executionMode === 'direct') return createDirectIntentPlan(analysis, sourceMessageId)
  if (analysis.executionMode === 'confirmed_plan') return pendingPlan
  return undefined
}

export function readPendingIntentPlan(context: Record<string, unknown> | undefined): PendingIntentPlan | undefined {
  const parsed = IntentGateStateSchema.safeParse(context?.[INTENT_GATE_CONTEXT_KEY])
  return parsed.success ? parsed.data.pendingPlan : undefined
}

export function nextIntentGateState(
  analysis: IntentAnalysis,
  current: PendingIntentPlan | undefined,
  sourceMessageId: string,
): IntentGateState {
  if (analysis.pendingPlanDisposition === 'replace') {
    return {
      schemaVersion: 1,
      pendingPlan: createPendingIntentPlan(analysis, sourceMessageId),
    }
  }
  if (analysis.pendingPlanDisposition === 'keep' && current) {
    return { schemaVersion: 1, pendingPlan: current }
  }
  return { schemaVersion: 1 }
}

export function renderIntentResponse(analysis: IntentAnalysis, userPrompt: string): string {
  const chinese = /[\u3400-\u9fff]/.test(userPrompt)

  if (analysis.decision === 'respond') return analysis.directResponse || analysis.summary

  if (analysis.decision === 'clarify') {
    const title = chinese ? '我理解的目标' : 'My understanding'
    const questionTitle = chinese ? '需要你补充确认' : 'Please clarify'
    return [
      `## ${title}`,
      '',
      analysis.goal,
      '',
      `## ${questionTitle}`,
      '',
      ...analysis.questions.map((question, index) => `${index + 1}. ${question}`),
    ].join('\n')
  }

  if (analysis.decision === 'propose') {
    const goalTitle = chinese ? '目标确认' : 'Goal confirmation'
    const planTitle = chinese ? '执行方案' : 'Execution plan'
    const assumptionTitle = chinese ? '当前假设' : 'Current assumptions'
    const confirmation = chinese
      ? '如果以上目标和方案准确，请明确回复“确认执行”。若需调整，请直接说明要修改的范围或约束。'
      : 'If this goal and plan are accurate, explicitly reply "Confirm execution". Otherwise, describe the scope or constraint to revise.'
    const sections = [
      `## ${goalTitle}`,
      '',
      analysis.goal,
      '',
      `## ${planTitle}`,
      '',
      ...analysis.plan.map((step, index) => `${index + 1}. ${step}`),
    ]
    if (analysis.assumptions.length > 0) {
      sections.push(
        '',
        `## ${assumptionTitle}`,
        '',
        ...analysis.assumptions.map(item => `- ${item}`),
      )
    }
    sections.push('', confirmation)
    return sections.join('\n')
  }

  return ''
}

export function buildIntentExecutionPrompt(
  basePrompt: string,
  plan: PendingIntentPlan,
  mode: 'direct' | 'confirmed_plan',
): string {
  const heading = mode === 'direct' ? 'Autonomously Resolved User Intent' : 'Confirmed User Intent'
  const instruction = mode === 'direct'
    ? 'The intent gate first understood the user goal, then created this outcome plan without seeing any tools. Follow the goal and plan within the existing authorization and safety boundaries.'
    : 'The user explicitly confirmed the following goal and outcome plan. Follow it within the existing authorization and safety boundaries.'
  const planLabel = mode === 'direct' ? 'Execution plan' : 'Confirmed plan'
  return `${basePrompt}

# ${heading}

${instruction}

Goal:
${plan.goal}

${planLabel}:
${plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

Assumptions:
${plan.assumptions.map(item => `- ${item}`).join('\n') || '- none'}

Do not select or call a tool merely because it is available. First map the next action to a plan step, then use a tool only if that action actually requires one. The plan describes outcomes and does not prescribe tools.

Do not silently expand the resolved scope. If new ambiguity materially affects the result, stop and ask the user instead of guessing. Intent resolution does not authorize destructive or external actions beyond the normal approval policy.`
}

export function createIntentAnalysisFallback(userPrompt: string): IntentAnalysis {
  const chinese = /[\u3400-\u9fff]/.test(userPrompt)
  const trimmedPrompt = userPrompt.trim()

  if (looksLikeInformationRequest(trimmedPrompt)) {
    return {
      decision: 'execute',
      executionMode: 'direct',
      requestType: 'information',
      complexity: 'simple',
      action: 'answer',
      risk: 'none',
      goal: chinese ? `回答用户的问题：${trimmedPrompt}` : `Answer the user's question: ${trimmedPrompt}`,
      summary: chinese ? '这是一个目标明确的信息问句，可以直接回答。' : 'This is a clear information request that can be answered directly.',
      confidence: 0.8,
      missingInformation: [],
      questions: [],
      assumptions: [],
      plan: [chinese ? '根据已有上下文直接回答问题' : 'Answer the question directly from the available context'],
      directResponse: '',
      pendingPlanDisposition: 'clear',
    }
  }

  if (trimmedPrompt) {
    return {
      decision: 'execute',
      executionMode: 'direct',
      requestType: 'task',
      complexity: 'complex',
      action: 'execute',
      risk: 'local_write',
      goal: trimmedPrompt,
      summary: chinese
        ? '意图预分析不可用，将原始目标交给主 Agent 自主规划。'
        : 'Intent pre-analysis is unavailable, so the original goal will be planned by the main Agent.',
      confidence: 0.8,
      missingInformation: [],
      questions: [],
      assumptions: [],
      plan: [
        chinese
          ? '根据原始请求和现有上下文自主制定计划；可安全推断时直接推进，只有遇到真正阻塞结果的歧义才询问用户'
          : 'Plan autonomously from the original request and available context; proceed with safe assumptions and ask only when ambiguity truly blocks the outcome',
      ],
      directResponse: '',
      pendingPlanDisposition: 'clear',
    }
  }

  return {
    decision: 'respond',
    executionMode: 'none',
    requestType: 'task',
    complexity: 'simple',
    action: 'conversation',
    risk: 'none',
    goal: chinese ? '等待用户输入请求' : 'Wait for a user request',
    summary: chinese ? '请告诉我你想完成什么。' : 'Please tell me what you would like to accomplish.',
    confidence: 0,
    missingInformation: [],
    questions: [],
    assumptions: [],
    plan: [],
    directResponse: chinese ? '请告诉我你想完成什么。' : 'Please tell me what you would like to accomplish.',
    pendingPlanDisposition: 'clear',
  }
}

/**
 * Resolve the hot-path intent without another model round trip.
 *
 * The main Agent already owns planning, clarification, and tool selection. The
 * preflight layer only needs to preserve an explicitly confirmed pending plan;
 * every other non-empty request can start the streaming Agent immediately.
 */
export function resolveImmediateIntent(
  userPrompt: string,
  pendingPlan?: PendingIntentPlan,
): IntentAnalysis {
  if (pendingPlan && hasExplicitPlanConfirmation(userPrompt)) {
    return {
      decision: 'execute',
      executionMode: 'confirmed_plan',
      requestType: 'task',
      complexity: pendingPlan.steps.length > 1 ? 'complex' : 'simple',
      action: pendingPlan.action,
      risk: pendingPlan.risk,
      goal: pendingPlan.goal,
      summary: /[\u3400-\u9fff]/.test(userPrompt)
        ? '用户已明确确认上一版方案。'
        : 'The user explicitly confirmed the previous plan.',
      confidence: 1,
      missingInformation: [],
      questions: [],
      assumptions: pendingPlan.assumptions,
      plan: pendingPlan.steps,
      directResponse: '',
      pendingPlanDisposition: 'clear',
    }
  }

  return createIntentAnalysisFallback(userPrompt)
}

/**
 * Some OpenAI-compatible providers return valid JSON as plain text even when
 * structured output was requested. Recover that result before treating the
 * classifier call as unavailable.
 */
export function recoverIntentAnalysisFromError(error: unknown): IntentAnalysis | undefined {
  if (!error || typeof error !== 'object') return undefined
  const text = 'text' in error && typeof error.text === 'string' ? error.text : ''
  if (!text) return undefined

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!candidate) return undefined

  try {
    const parsed = IntentAnalysisSchema.safeParse(JSON.parse(candidate))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function parseStructuredText<T>(
  text: string,
  schema: z.ZodType<T>,
  label = 'structured response',
): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const candidate = fenced || (start >= 0 && end > start ? text.slice(start, end + 1) : '')
  if (!candidate) {
    throw new Error(`Could not parse ${label}: response did not contain a JSON object`)
  }

  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch (error) {
    throw new Error(`Could not parse ${label}: invalid JSON`, { cause: error })
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Could not parse ${label}: response did not match the required schema`)
  }
  return parsed.data
}

function looksLikeInformationRequest(userPrompt: string): boolean {
  if (!userPrompt) return false
  const chineseQuestion = /(?:是什么|什么是|是谁|为什么|为何|怎么|怎样|如何|多少|哪里|哪儿|哪个|哪些|区别|含义|用途|作用|原理|介绍(?:一下)?|解释(?:一下)?|说明(?:一下)?|是否|能否|可以吗|吗[？?]?$)/
  const englishQuestion = /^(?:what|who|where|when|why|how|which|explain|describe|tell me|is|are|can|could|does|do)\b/i
  return chineseQuestion.test(userPrompt) || englishQuestion.test(userPrompt) || /[？?]$/.test(userPrompt)
}

function recentConversation(messages: ModelMessage[]): string {
  return messages
    .slice(-8)
    .map(message => {
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content)
      return `${message.role}: ${content.slice(0, 2_000)}`
    })
    .join('\n')
    .slice(-12_000)
}
