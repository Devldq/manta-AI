import { describe, expect, it } from 'vitest'
import {
  INTENT_CONFIRMATION_CONFIDENCE,
  buildIntentExecutionPrompt,
  buildIntentPlanningPrompt,
  buildIntentUnderstandingPrompt,
  canExecuteDirectly,
  createIntentAnalysisFallback,
  enforceIntentGate,
  groundIntentPlan,
  hasExplicitPlanConfirmation,
  nextIntentGateState,
  renderIntentResponse,
  resolveImmediateIntent,
  resolveIntentExecutionPlan,
  recoverIntentAnalysisFromError,
  type IntentAnalysis,
  type IntentUnderstanding,
  type PendingIntentPlan,
} from './intent-classifier.js'

function analysis(patch: Partial<IntentAnalysis> = {}): IntentAnalysis {
  return {
    decision: 'propose',
    executionMode: 'none',
    requestType: 'task',
    complexity: 'complex',
    action: 'modify',
    risk: 'local_write',
    goal: '修复登录错误',
    summary: '修复登录错误并验证回归',
    confidence: 0.95,
    missingInformation: [],
    questions: [],
    assumptions: ['只修改本地代码'],
    plan: ['定位登录失败原因', '实现修复', '运行定向测试'],
    directResponse: '',
    pendingPlanDisposition: 'replace',
    ...patch,
  }
}

function pendingPlan(): PendingIntentPlan {
  return {
    schemaVersion: 1,
    id: 'plan-1',
    goal: '修复登录错误',
    action: 'modify',
    risk: 'local_write',
    assumptions: ['只修改本地代码'],
    steps: ['定位登录失败原因', '实现修复', '运行定向测试'],
    sourceMessageId: 'message-1',
    createdAt: '2026-07-25T00:00:00.000Z',
  }
}

function understanding(patch: Partial<IntentUnderstanding> = {}): IntentUnderstanding {
  return {
    requestType: 'task',
    goal: '修复登录错误',
    desiredOutcome: '用户可以正常登录且现有行为不回退',
    target: '登录流程',
    ambiguity: 'clear',
    confidence: 0.95,
    missingInformation: [],
    questions: [],
    assumptions: ['只处理当前项目'],
    pendingPlanRelation: 'none',
    ...patch,
  }
}

describe('intent execution gate', () => {
  it('directly executes a clear simple low-risk task without a persisted plan', () => {
    const result = enforceIntentGate(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'simple',
      confidence: 0.8,
      goal: '修正一个明确的拼写错误',
      plan: ['修正指定文本并检查结果'],
    }), undefined, '把标题里的 Mantaa 改成 Manta')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(result.pendingPlanDisposition).toBe('clear')
    expect(canExecuteDirectly(result)).toBe(true)
  })

  it('routes a clear information question to the main Agent when classification fails', () => {
    const result = createIntentAnalysisFallback('manta-ai 是什么软件')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(result.requestType).toBe('information')
    expect(result.action).toBe('answer')
    expect(canExecuteDirectly(result)).toBe(true)
  })

  it('separates purpose understanding from outcome planning without tool selection', () => {
    const purposePrompt = buildIntentUnderstandingPrompt({
      agentName: 'default',
      pendingPlan: 'none',
      conversation: '',
      userPrompt: '修复登录错误',
    })
    const planningPrompt = buildIntentPlanningPrompt(understanding(), 'none', '修复登录错误')

    expect(purposePrompt).toContain('Identify the user purpose only')
    expect(purposePrompt).toContain('do not plan actions or tools')
    expect(planningPrompt).toContain('<intent_understanding>')
    expect(planningPrompt).toContain('outcome plan')
  })

  it('does not let the planning stage reinterpret the understood goal', () => {
    const result = groundIntentPlan(
      analysis({
        goal: '重写整个认证系统',
        assumptions: ['可以扩大范围'],
      }),
      understanding(),
    )

    expect(result.goal).toBe('修复登录错误')
    expect(result.assumptions).toEqual(['只处理当前项目'])
    expect(result.understanding?.desiredOutcome).toContain('正常登录')
  })

  it('forces clarification when purpose understanding found critical ambiguity', () => {
    const result = groundIntentPlan(
      analysis({ decision: 'execute', executionMode: 'direct' }),
      understanding({
        ambiguity: 'needs_clarification',
        missingInformation: ['未说明要修复哪个登录入口'],
        questions: ['你指的是桌面端还是网页端登录？'],
      }),
    )

    expect(result.decision).toBe('clarify')
    expect(result.executionMode).toBe('none')
    expect(result.plan).toEqual([])
    expect(result.questions).toEqual(['你指的是桌面端还是网页端登录？'])
  })

  it('hands a non-empty request to the main Agent when pre-analysis fails', () => {
    const result = createIntentAnalysisFallback('我想做一个类似 Obsidian 的应用')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(result.goal).toBe('我想做一个类似 Obsidian 的应用')
    expect(result.questions).toEqual([])
    expect(canExecuteDirectly(result)).toBe(true)
  })

  it('starts a broad Chinese request immediately instead of asking model-authored English questions', () => {
    const result = resolveImmediateIntent('我想做一个类似 Obsidian 的应用')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(result.goal).toBe('我想做一个类似 Obsidian 的应用')
    expect(result.questions).toEqual([])
    expect(renderIntentResponse(result, '我想做一个类似 Obsidian 的应用')).toBe('')
  })

  it('preserves an explicitly confirmed pending plan without model pre-analysis', () => {
    const pending = pendingPlan()
    const result = resolveImmediateIntent('确认执行', pending)

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('confirmed_plan')
    expect(result.confidence).toBe(1)
    expect(result.goal).toBe(pending.goal)
    expect(result.plan).toEqual(pending.steps)
    expect(resolveIntentExecutionPlan(result, pending, 'message-confirm')).toBe(pending)
  })

  it('routes a pending-plan revision to the main Agent instead of treating it as confirmation', () => {
    const result = resolveImmediateIntent('确认执行，但是先不要跑测试', pendingPlan())

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(result.goal).toBe('确认执行，但是先不要跑测试')
    expect(result.pendingPlanDisposition).toBe('clear')
  })

  it('recovers valid JSON returned as fenced text by compatible providers', () => {
    const expected = analysis({
      decision: 'execute',
      executionMode: 'direct',
      requestType: 'information',
      complexity: 'simple',
      action: 'answer',
      risk: 'none',
      plan: ['直接回答问题'],
      pendingPlanDisposition: 'clear',
    })
    const recovered = recoverIntentAnalysisFromError({
      text: `\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``,
    })

    expect(recovered).toEqual(expected)
  })

  it('lets the model directly execute complex local work', () => {
    const result = enforceIntentGate(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'complex',
      risk: 'local_write',
      plan: [
        '理解现有产品结构',
        '确定最小可用范围',
        '实现核心编辑体验',
        '实现本地数据持久化',
        '验证关键使用流程',
      ],
    }), undefined, '我想做一个类似 Obsidian 的应用')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
    expect(canExecuteDirectly(result)).toBe(true)
  })

  it('does not replace the model decision with a numeric confidence threshold', () => {
    const result = enforceIntentGate(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'complex',
      confidence: 0.45,
      risk: 'local_write',
    }), undefined, '先探索现有项目，再实现一个可用的 Obsidian 类 MVP')

    expect(result.decision).toBe('execute')
    expect(result.executionMode).toBe('direct')
  })

  it('turns unsafe direct execution into a proposal', () => {
    const result = enforceIntentGate(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'complex',
      risk: 'external_write',
    }), undefined, '重构系统并发布')

    expect(result.decision).toBe('propose')
    expect(result.executionMode).toBe('none')
    expect(result.pendingPlanDisposition).toBe('replace')
  })

  it('does not encode complexity or plan length as code confirmation requirements', () => {
    expect(canExecuteDirectly(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'complex',
      plan: Array.from({ length: 10 }, (_, index) => `步骤 ${index + 1}`),
    }))).toBe(true)
  })

  it('fails closed when confirmation confidence is below the threshold', () => {
    const result = enforceIntentGate(
      analysis({
        decision: 'execute',
        executionMode: 'confirmed_plan',
        confidence: INTENT_CONFIRMATION_CONFIDENCE - 0.01,
      }),
      pendingPlan(),
      '确认执行',
    )

    expect(result.decision).toBe('clarify')
    expect(result.pendingPlanDisposition).toBe('keep')
    expect(result.questions.length).toBeGreaterThan(0)
  })

  it('executes only the persisted plan after confident confirmation', () => {
    const pending = pendingPlan()
    const result = enforceIntentGate(
      analysis({
        decision: 'execute',
        executionMode: 'confirmed_plan',
        goal: '扩大到整个认证系统',
        plan: ['删除认证模块'],
      }),
      pending,
      '确认执行',
    )

    expect(result.decision).toBe('execute')
    expect(result.goal).toBe(pending.goal)
    expect(result.plan).toEqual(pending.steps)
    expect(result.risk).toBe(pending.risk)
    expect(result.pendingPlanDisposition).toBe('clear')
  })

  it('persists a proposed plan for a later turn', () => {
    const state = nextIntentGateState(
      analysis(),
      undefined,
      'message-2',
    )

    expect(state.pendingPlan?.goal).toBe('修复登录错误')
    expect(state.pendingPlan?.steps).toHaveLength(3)
    expect(state.pendingPlan?.sourceMessageId).toBe('message-2')
  })

  it('requires a standalone confirmation and rejects scope changes', () => {
    expect(hasExplicitPlanConfirmation('确认执行')).toBe(true)
    expect(hasExplicitPlanConfirmation('按上述方案执行')).toBe(true)
    expect(hasExplicitPlanConfirmation('好的')).toBe(false)
    expect(hasExplicitPlanConfirmation('确认执行，但是先不要跑测试')).toBe(false)
  })

  it('renders a proposal with an explicit confirmation request', () => {
    const text = renderIntentResponse(analysis(), '请修复登录错误')

    expect(text).toContain('## 目标确认')
    expect(text).toContain('## 执行方案')
    expect(text).toContain('确认执行')
  })

  it('injects the exact confirmed scope into the Agent prompt', () => {
    const prompt = buildIntentExecutionPrompt('base prompt', pendingPlan(), 'confirmed_plan')

    expect(prompt).toContain('base prompt')
    expect(prompt).toContain('修复登录错误')
    expect(prompt).toContain('1. 定位登录失败原因')
    expect(prompt).toContain('Do not select or call a tool merely because it is available')
    expect(prompt).toContain('Do not silently expand the resolved scope')
  })

  it('creates a transient execution plan for direct work without persisting a confirmation gate', () => {
    const direct = enforceIntentGate(analysis({
      decision: 'execute',
      executionMode: 'direct',
      complexity: 'simple',
      action: 'inspect',
      risk: 'read_only',
      plan: ['读取指定配置并报告结果'],
    }), undefined, '看看这个配置')
    const plan = resolveIntentExecutionPlan(direct, undefined, 'message-direct')

    expect(plan?.goal).toBe('修复登录错误')
    expect(plan?.sourceMessageId).toBe('message-direct')
    expect(nextIntentGateState(direct, undefined, 'message-direct').pendingPlan).toBeUndefined()
    expect(buildIntentExecutionPrompt('base prompt', plan!, 'direct')).toContain('Autonomously Resolved User Intent')
  })
})
