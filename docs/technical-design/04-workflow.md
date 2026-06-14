# 工作流技术方案 / Workflow Technical Design

## 1. 概述

工作流是Manta平台的**任务编排引擎**，让用户定义可重用的任务流程。本文档详细描述工作流模块的技术实现方案。

### 1.1 设计目标
- **可视化编辑**：支持拖拽式工作流设计
- **类型丰富**：支持多种步骤类型
- **状态管理**：完整的执行状态追踪和恢复机制
- **可扩展性**：易于添加新的步骤类型

### 1.2 核心概念
- **WorkflowDef**：工作流定义，包含步骤列表和配置
- **WorkflowStep**：工作流步骤，定义具体执行逻辑
- **WorkflowExecution**：执行实例，记录运行状态和日志
- **WorkflowEngine**：执行引擎，负责解析和执行工作流

---

## 2. 工作流定义

### 2.1 数据结构

```typescript
// 工作流定义
interface WorkflowDef {
  id: string
  name: string
  description?: string
  version: string
  steps: WorkflowStep[]
  variables?: WorkflowVariable[]
  config?: WorkflowConfig
  createdAt: Date
  updatedAt: Date
}

// 工作流步骤
interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  description?: string
  config: StepConfig
  next?: string | string[]
  condition?: string
  timeout?: number
  retries?: number
  position?: { x: number; y: number }
}

// 步骤类型
type WorkflowStepType =
  | 'start'           // 开始节点
  | 'end'             // 结束节点
  | 'agent'           // Agent执行
  | 'human_in_loop'   // 人工审核
  | 'parallel'        // 并行执行
  | 'conditional'     // 条件分支
  | 'loop'            // 循环
  | 'delay'           // 延时等待
  | 'webhook'         // Webhook调用

// 步骤配置
interface StepConfig {
  agentName?: string
  agentInput?: string | Record<string, any>
  actions?: Record<string, string>
  notify?: boolean | { mac?: boolean; webhook?: boolean }
  assignee?: string
  branches?: WorkflowStep[]
  conditionExpression?: string
  trueBranch?: string
  falseBranch?: string
  loopCondition?: string
  maxIterations?: number
  loopBody?: string
  duration?: number
  webhookUrl?: string
  webhookMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  webhookHeaders?: Record<string, string>
  webhookBody?: string
}

// 工作流变量
interface WorkflowVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue?: any
  description?: string
  required?: boolean
}

// 工作流配置
interface WorkflowConfig {
  maxExecutionTime?: number
  maxSteps?: number
  errorHandling?: 'stop' | 'continue' | 'retry'
  logging?: boolean
  notifications?: {
    onStart?: boolean
    onComplete?: boolean
    onError?: boolean
  }
}
```

### 2.2 工作流解析器

```typescript
class WorkflowParser {
  parse(definition: WorkflowDef): ParsedWorkflow {
    this.validate(definition)
    const stepGraph = this.buildStepGraph(definition.steps)
    this.detectCycles(stepGraph)
    
    return {
      id: definition.id,
      name: definition.name,
      steps: definition.steps,
      stepGraph,
      variables: definition.variables || [],
      config: definition.config || {}
    }
  }
  
  private validate(definition: WorkflowDef): void {
    if (!definition.id || !definition.name) {
      throw new Error('Workflow must have id and name')
    }
    
    if (!definition.steps || definition.steps.length === 0) {
      throw new Error('Workflow must have at least one step')
    }
    
    // 检查步骤ID唯一性
    const stepIds = new Set<string>()
    for (const step of definition.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step id: ${step.id}`)
      }
      stepIds.add(step.id)
    }
    
    // 检查开始和结束节点
    const hasStart = definition.steps.some(s => s.type === 'start')
    const hasEnd = definition.steps.some(s => s.type === 'end')
    if (!hasStart || !hasEnd) {
      throw new Error('Workflow must have start and end steps')
    }
  }
}
```

---

## 3. 工作流执行引擎

### 3.1 引擎架构

```typescript
class WorkflowEngine {
  private stepHandlers: Map<WorkflowStepType, StepHandler>
  private executionStore: ExecutionStore
  private agentRegistry: AgentRegistry
  
  constructor() {
    this.stepHandlers = new Map()
    this.registerDefaultHandlers()
  }
  
  private registerDefaultHandlers(): void {
    this.stepHandlers.set('agent', new AgentStepHandler())
    this.stepHandlers.set('human_in_loop', new HumanInLoopStepHandler())
    this.stepHandlers.set('parallel', new ParallelStepHandler())
    this.stepHandlers.set('conditional', new ConditionalStepHandler())
    this.stepHandlers.set('loop', new LoopStepHandler())
    this.stepHandlers.set('delay', new DelayStepHandler())
    this.stepHandlers.set('webhook', new WebhookStepHandler())
  }
  
  async execute(workflowId: string, params: Record<string, any> = {}): Promise<WorkflowExecution> {
    // 1. 加载工作流定义
    const workflow = await this.loadWorkflow(workflowId)
    
    // 2. 创建执行实例
    const execution = await this.createExecution(workflow, params)
    
    // 3. 执行工作流
    try {
      await this.runWorkflow(execution, workflow)
    } catch (error) {
      await this.handleExecutionError(execution, error)
    }
    
    return execution
  }
  
  private async runWorkflow(execution: WorkflowExecution, workflow: ParsedWorkflow): Promise<void> {
    const context = this.createContext(execution, workflow)
    const startStep = workflow.steps.find(s => s.type === 'start')
    
    if (!startStep) {
      throw new Error('No start step found')
    }
    
    await this.executeStep(startStep, context, workflow)
  }
  
  private async executeStep(step: WorkflowStep, context: ExecutionContext, workflow: ParsedWorkflow): Promise<void> {
    execution.currentStepId = step.id
    await this.logStepStart(execution, step)
    
    const handler = this.stepHandlers.get(step.type)
    if (!handler) {
      throw new Error(`No handler for step type: ${step.type}`)
    }
    
    const result = await handler.execute(step, context)
    await this.logStepComplete(execution, step, result)
    
    if (result.nextStepId) {
      const nextStep = workflow.steps.find(s => s.id === result.nextStepId)
      if (nextStep) {
        await this.executeStep(nextStep, context, workflow)
      }
    }
  }
}
```

### 3.2 执行上下文

```typescript
class ExecutionContext {
  private variables: Map<string, any>
  private stepResults: Map<string, any>
  private execution: WorkflowExecution
  
  constructor(execution: WorkflowExecution, initialVariables: Record<string, any>) {
    this.execution = execution
    this.variables = new Map(Object.entries(initialVariables))
    this.stepResults = new Map()
  }
  
  getVariable(name: string): any {
    return this.variables.get(name)
  }
  
  setVariable(name: string, value: any): void {
    this.variables.set(name, value)
  }
  
  getStepResult(stepId: string): any {
    return this.stepResults.get(stepId)
  }
  
  setStepResult(stepId: string, result: any): void {
    this.stepResults.set(stepId, result)
  }
  
  evaluateExpression(expression: string): any {
    const sandbox = {
      variables: Object.fromEntries(this.variables),
      results: Object.fromEntries(this.stepResults)
    }
    
    return evaluateInSandbox(expression, sandbox)
  }
}
```

---

## 4. 步骤处理器

### 4.1 Agent步骤处理器

```typescript
class AgentStepHandler implements StepHandler {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    const { agentName, agentInput } = step.config
    
    if (!agentName) {
      throw new Error('Agent name is required for agent step')
    }
    
    const agent = await agentRegistry.getAgent(agentName)
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`)
    }
    
    const input = this.prepareInput(agentInput, context)
    const startTime = Date.now()
    const result = await agent.execute(input)
    const duration = Date.now() - startTime
    
    context.setStepResult(step.id, result)
    
    return {
      success: true,
      output: result,
      duration,
      nextStepId: step.next
    }
  }
  
  private prepareInput(input: string | Record<string, any> | undefined, context: ExecutionContext): any {
    if (!input) return {}
    
    if (typeof input === 'string') {
      return input.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        const value = context.getVariable(varName)
        return value !== undefined ? String(value) : match
      })
    }
    
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const varName = value.slice(2, -2).trim()
        result[key] = context.getVariable(varName)
      } else {
        result[key] = value
      }
    }
    
    return result
  }
}
```

### 4.2 人工审核步骤处理器

```typescript
class HumanInLoopStepHandler implements StepHandler {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    const { actions, notify, assignee } = step.config
    
    const approvalRequest = await this.createApprovalRequest({
      executionId: context.execution.taskId,
      stepId: step.id,
      actions: actions || { approve: '批准', reject: '拒绝' },
      assignee,
      context: context.toJSON()
    })
    
    if (notify) {
      await this.sendNotification(approvalRequest, notify)
    }
    
    return {
      success: true,
      status: 'waiting',
      waitingFor: 'human_approval',
      approvalRequestId: approvalRequest.id
    }
  }
  
  async resume(step: WorkflowStep, context: ExecutionContext, approvalResult: ApprovalResult): Promise<StepResult> {
    const { action, comment } = approvalResult
    
    context.setStepResult(step.id, {
      action,
      comment,
      approvedAt: new Date(),
      approvedBy: approvalResult.approver
    })
    
    let nextStepId = step.next
    if (action === 'reject' && step.config.falseBranch) {
      nextStepId = step.config.falseBranch
    }
    
    return {
      success: true,
      output: approvalResult,
      nextStepId
    }
  }
}
```

### 4.3 并行步骤处理器

```typescript
class ParallelStepHandler implements StepHandler {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    const { branches } = step.config
    
    if (!branches || branches.length === 0) {
      throw new Error('Parallel step must have branches')
    }
    
    const results = await Promise.allSettled(
      branches.map(branch => this.executeBranch(branch, context))
    )
    
    const failures = results.filter(r => r.status === 'rejected')
    if (failures.length > 0) {
      return {
        success: false,
        error: `${failures.length} branches failed`,
        partialResults: results.map(r => r.status === 'fulfilled' ? r.value : r.reason)
      }
    }
    
    const mergedResults = results.map(r => (r as PromiseFulfilledResult<any>).value)
    
    return {
      success: true,
      output: mergedResults,
      nextStepId: step.next
    }
  }
}
```

### 4.4 条件步骤处理器

```typescript
class ConditionalStepHandler implements StepHandler {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    const { conditionExpression, trueBranch, falseBranch } = step.config
    
    if (!conditionExpression) {
      throw new Error('Conditional step must have condition expression')
    }
    
    const conditionResult = context.evaluateExpression(conditionExpression)
    const nextStepId = conditionResult ? trueBranch : falseBranch
    
    return {
      success: true,
      output: { condition: conditionResult },
      nextStepId
    }
  }
}
```

### 4.5 循环步骤处理器

```typescript
class LoopStepHandler implements StepHandler {
  async execute(step: WorkflowStep, context: ExecutionContext): Promise<StepResult> {
    const { loopCondition, maxIterations = 100, loopBody } = step.config
    
    if (!loopCondition) {
      throw new Error('Loop step must have loop condition')
    }
    
    let iterations = 0
    const results: any[] = []
    
    while (iterations < maxIterations) {
      const shouldContinue = context.evaluateExpression(loopCondition)
      if (!shouldContinue) break
      
      const result = await this.executeLoopBody(loopBody, context)
      results.push(result)
      
      iterations++
    }
    
    if (iterations >= maxIterations) {
      return {
        success: false,
        error: `Loop reached maximum iterations (${maxIterations})`,
        output: results
      }
    }
    
    return {
      success: true,
      output: results,
      iterations,
      nextStepId: step.next
    }
  }
}
```

---

## 5. 状态管理

### 5.1 执行状态机

```typescript
class ExecutionStateMachine {
  private states: Map<string, ExecutionState> = new Map()
  
  constructor() {
    this.defineStates()
  }
  
  private defineStates(): void {
    this.states.set('created', {
      name: 'created',
      transitions: ['running', 'failed']
    })
    
    this.states.set('running', {
      name: 'running',
      transitions: ['waiting', 'completed', 'failed', 'paused']
    })
    
    this.states.set('waiting', {
      name: 'waiting',
      transitions: ['running', 'failed', 'timeout']
    })
    
    this.states.set('completed', {
      name: 'completed',
      transitions: []
    })
    
    this.states.set('failed', {
      name: 'failed',
      transitions: ['running']
    })
  }
  
  canTransition(from: string, to: string): boolean {
    const state = this.states.get(from)
    return state ? state.transitions.includes(to) : false
  }
}
```

### 5.2 执行存储

```typescript
class ExecutionStore {
  private db: Database
  
  async save(execution: WorkflowExecution): Promise<void> {
    await this.db.run(`
      INSERT OR REPLACE INTO workflow_executions 
      (id, workflow_id, status, current_step_id, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      execution.taskId,
      execution.workflowId,
      execution.status,
      execution.currentStepId,
      JSON.stringify(execution.context),
      execution.createdAt,
      execution.updatedAt
    ])
    
    for (const stepLog of execution.steps) {
      await this.db.run(`
        INSERT OR REPLACE INTO step_logs
        (execution_id, step_id, step_name, status, agent_name, started_at, completed_at, error, actions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        execution.taskId,
        stepLog.stepId,
        stepLog.stepName,
        stepLog.status,
        stepLog.agentName,
        stepLog.startedAt,
        stepLog.completedAt,
        stepLog.error,
        JSON.stringify(stepLog.actions)
      ])
    }
  }
}
```

---

## 6. API 实现

### 6.1 API 路由

```typescript
// app/api/workflow/route.ts
export async function GET() {
  const workflows = await workflowService.list()
  return NextResponse.json(workflows)
}

export async function POST(request: Request) {
  const body = await request.json()
  const workflow = await workflowService.create(body)
  return NextResponse.json(workflow, { status: 201 })
}

// app/api/workflow/[id]/run/route.ts
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const execution = await workflowEngine.execute(params.id, body)
  return NextResponse.json(execution)
}

// app/api/workflow/executions/[execId]/approve/route.ts
export async function POST(request: Request, { params }: { params: { execId: string } }) {
  const { action, comment } = await request.json()
  const result = await workflowEngine.approveStep(params.execId, { action, comment })
  return NextResponse.json(result)
}
```

---

## 7. 前端组件设计

### 7.1 工作流编辑器

```tsx
// components/workflow/WorkflowEditor.tsx
export function WorkflowEditor({ workflowId }: { workflowId?: string }) {
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  
  useEffect(() => {
    if (workflowId) {
      loadWorkflow(workflowId).then(setWorkflow)
    }
  }, [workflowId])
  
  useEffect(() => {
    if (workflow) {
      const { nodes: flowNodes, edges: flowEdges } = convertToFlow(workflow.steps)
      setNodes(flowNodes)
      setEdges(flowEdges)
    }
  }, [workflow])
  
  const handleSave = async () => {
    const steps = convertToSteps(nodes, edges)
    await workflowService.update(workflowId, { steps })
  }
  
  return (
    <div className="h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
      >
        <Controls />
        <MiniMap />
        <Background />
      </ReactFlow>
      
      <Toolbar>
        <Button onClick={handleSave}>保存</Button>
        <Button variant="outline" onClick={() => workflowEngine.execute(workflowId)}>
          运行
        </Button>
      </Toolbar>
    </div>
  )
}
```

### 7.2 执行监控组件

```tsx
// components/workflow/ExecutionMonitor.tsx
export function ExecutionMonitor({ executionId }: { executionId: string }) {
  const { data: execution, isLoading } = useSWR(
    `/api/workflow/executions/${executionId}`,
    fetcher,
    { refreshInterval: 1000 }
  )
  
  if (isLoading) return <LoadingSkeleton />
  if (!execution) return <div>Execution not found</div>
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>执行状态</span>
            <Badge variant={getStatusVariant(execution.status)}>
              {execution.status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-muted-foreground">开始时间</span>
              <p>{formatDateTime(execution.createdAt)}</p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">当前步骤</span>
              <p>{execution.currentStepId || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>步骤日志</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {execution.steps.map((step, index) => (
              <StepLogItem key={step.stepId} step={step} index={index} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

---

## 8. 错误处理

### 8.1 错误类型

```typescript
export class WorkflowNotFoundError extends Error {
  constructor(id: string) {
    super(`Workflow not found: ${id}`)
    this.name = 'WorkflowNotFoundError'
  }
}

export class InvalidWorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(`Invalid workflow definition: ${message}`)
    this.name = 'InvalidWorkflowDefinitionError'
  }
}

export class StepExecutionError extends Error {
  constructor(stepId: string, message: string) {
    super(`Step ${stepId} execution failed: ${message}`)
    this.name = 'StepExecutionError'
  }
}

export class WorkflowTimeoutError extends Error {
  constructor(executionId: string) {
    super(`Workflow execution ${executionId} timed out`)
    this.name = 'WorkflowTimeoutError'
  }
}
```

### 8.2 重试机制

```typescript
class RetryHandler {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const { maxRetries = 3, delay = 1000, backoff = 2 } = options
    let lastError: Error
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error as Error
        
        if (attempt < maxRetries) {
          const delayMs = delay * Math.pow(backoff, attempt)
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }
      }
    }
    
    throw lastError!
  }
}
```

---

## 9. 实现计划

### 9.1 第一阶段：基础功能（2周）
1. 实现工作流定义和解析器
2. 实现基础步骤类型（agent、conditional、loop）
3. 实现执行引擎和状态管理
4. 完成工作流CRUD API

### 9.2 第二阶段：增强功能（2周）
1. 实现人工审核步骤
2. 实现并行执行步骤
3. 实现可视化编辑器
4. 添加执行监控和日志

### 9.3 第三阶段：扩展与优化（1周）
1. 实现Webhook和延时步骤
2. 添加错误处理和重试机制
3. 优化性能和缓存
4. 完善文档和示例

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于PRD 04创建 |

---

> 上一篇：[03-knowledge-base.md](./03-knowledge-base.md)
> 下一篇：[05-agent-app.md](./05-agent-app.md)