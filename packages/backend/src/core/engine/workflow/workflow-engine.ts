import type { WorkflowDef, WorkflowStep, WorkflowExecution, StepLog } from '@core/types'

/**
 * 工作流执行引擎
 * 负责执行工作流定义中的各个步骤
 */
export class WorkflowEngine {
  private executions: Map<string, WorkflowExecution> = new Map()

  /**
   * 启动工作流执行
   */
  async startExecution(
    taskId: string,
    workflow: WorkflowDef,
    context: Record<string, unknown> = {}
  ): Promise<WorkflowExecution> {
    const execution: WorkflowExecution = {
      taskId,
      workflowId: workflow.id,
      status: 'running',
      currentStepId: workflow.steps[0]?.id,
      steps: [],
      context: { ...context },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    this.executions.set(taskId, execution)

    // 开始执行第一步
    await this.executeNextStep(execution, workflow)

    return execution
  }

  /**
   * 执行下一个步骤
   */
  private async executeNextStep(
    execution: WorkflowExecution,
    workflow: WorkflowDef
  ): Promise<void> {
    const currentStep = workflow.steps.find(
      (step) => step.id === execution.currentStepId
    )

    if (!currentStep) {
      // 没有更多步骤，工作流完成
      execution.status = 'done'
      execution.updatedAt = new Date().toISOString()
      return
    }

    // 创建步骤日志
    const stepLog: StepLog = {
      stepId: currentStep.id,
      stepName: currentStep.name,
      status: 'running',
      agentName: currentStep.agentName,
      startedAt: new Date().toISOString(),
    }

    execution.steps.push(stepLog)

    try {
      // 执行步骤
      await this.executeStep(currentStep, execution)

      // 更新步骤状态
      stepLog.status = 'done'
      stepLog.completedAt = new Date().toISOString()

      // 移动到下一步
      execution.currentStepId = currentStep.next
      execution.updatedAt = new Date().toISOString()

      // 递归执行下一步
      await this.executeNextStep(execution, workflow)
    } catch (error) {
      // 步骤执行失败
      stepLog.status = 'failed'
      stepLog.error = error instanceof Error ? error.message : String(error)
      stepLog.completedAt = new Date().toISOString()

      execution.status = 'failed'
      execution.updatedAt = new Date().toISOString()
    }
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    // 根据步骤类型执行不同的逻辑
    switch (step.type) {
      case 'agent':
        await this.executeAgentStep(step, execution)
        break
      case 'human_in_loop':
        await this.executeHumanInLoopStep(step, execution)
        break
      case 'parallel':
        await this.executeParallelStep(step, execution)
        break
      case 'conditional':
        await this.executeConditionalStep(step, execution)
        break
      case 'loop':
        await this.executeLoopStep(step, execution)
        break
      default:
        throw new Error(`Unknown step type: ${step.type}`)
    }
  }

  /**
   * 执行智能体步骤
   */
  private async executeAgentStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    // 占位实现：模拟智能体执行
    console.log(`Executing agent step: ${step.name} with agent: ${step.agentName}`)

    // 模拟执行延迟
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 更新上下文
    execution.context[`${step.id}_result`] = `Result from ${step.name}`
  }

  /**
   * 执行人工介入步骤
   */
  private async executeHumanInLoopStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    console.log(`Human-in-loop step: ${step.name}`)
    execution.status = 'waiting'
    // 实际实现需要等待人工操作
  }

  /**
   * 执行并行步骤
   */
  private async executeParallelStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    if (!step.branches || step.branches.length === 0) {
      throw new Error('Parallel step must have branches')
    }

    console.log(`Executing parallel step: ${step.name} with ${step.branches.length} branches`)

    // 并行执行所有分支
    const promises = step.branches.map((branch) => {
      return this.executeStep(branch, execution)
    })

    await Promise.all(promises)
  }

  /**
   * 执行条件步骤
   */
  private async executeConditionalStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    console.log(`Conditional step: ${step.name}`)
    // 占位实现：根据条件选择下一个步骤
    // 实际实现需要评估条件表达式
  }

  /**
   * 执行循环步骤
   */
  private async executeLoopStep(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<void> {
    console.log(`Loop step: ${step.name}`)
    // 占位实现：执行循环逻辑
    // 实际实现需要处理循环条件和迭代
  }

  /**
   * 获取执行状态
   */
  getExecution(taskId: string): WorkflowExecution | undefined {
    return this.executions.get(taskId)
  }

  /**
   * 取消执行
   */
  cancelExecution(taskId: string): boolean {
    const execution = this.executions.get(taskId)
    if (execution && execution.status === 'running') {
      execution.status = 'failed'
      execution.updatedAt = new Date().toISOString()
      return true
    }
    return false
  }
}

/**
 * 创建工作流引擎实例
 */
export function createWorkflowEngine(): WorkflowEngine {
  return new WorkflowEngine()
}