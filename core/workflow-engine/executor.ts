/*  start: 工作流执行引擎 — 解析 WorkflowDef，依序执行步骤，支持 human_in_loop / parallel */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type {
  WorkflowDef,
  WorkflowStep,
  WorkflowExecution,
  StepLog,
  StepStatus,
  WorkflowExecutionStatus,
  Task,
  DataStore,
} from '../types'
import { findAgent } from '../../registry'
import { getRunner } from '../runner'
import { channelManager } from '../channel'

// AI: 工作流执行状态持久化目录
const DATA_DIR = path.join(os.homedir(), 'manta-data')
const EXECUTIONS_FILE = path.join(DATA_DIR, 'workflow-executions.json')

// ─── 执行状态持久化 ───────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readExecutions(): WorkflowExecution[] {
  ensureDataDir()
  if (!fs.existsSync(EXECUTIONS_FILE)) return []
  try {
    const raw = fs.readFileSync(EXECUTIONS_FILE, 'utf-8')
    return JSON.parse(raw) as WorkflowExecution[]
  } catch {
    return []
  }
}

function writeExecutions(execs: WorkflowExecution[]): void {
  ensureDataDir()
  const tmp = `${EXECUTIONS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(execs, null, 2), 'utf-8')
  fs.renameSync(tmp, EXECUTIONS_FILE)
}

export function getExecution(taskId: string): WorkflowExecution | null {
  return readExecutions().find((e) => e.taskId === taskId) ?? null
}

export function getAllExecutions(): WorkflowExecution[] {
  return readExecutions()
}

function saveExecution(exec: WorkflowExecution): void {
  const execs = readExecutions()
  const idx = execs.findIndex((e) => e.taskId === exec.taskId)
  if (idx >= 0) {
    execs[idx] = exec
  } else {
    execs.push(exec)
  }
  writeExecutions(execs)
}

// ─── 执行实例工厂 ───────────────────────────────────────────────

function createExecution(task: Task, workflow: WorkflowDef): WorkflowExecution {
  const now = new Date().toISOString()
  // AI: 初始化所有步骤的 StepLog（pending 状态）
  const steps: StepLog[] = flattenSteps(workflow.steps).map((s) => ({
    stepId: s.id,
    stepName: s.name,
    status: 'pending' as StepStatus,
    agentName: s.agentName,
    actions: s.actions,
  }))

  return {
    taskId: task.id,
    workflowId: workflow.id,
    status: 'running',
    currentStepId: workflow.steps[0]?.id,
    steps,
    context: {},
    createdAt: now,
    updatedAt: now,
  }
}

// AI: 将 parallel 分支展平为一维数组（用于 StepLog 初始化）
function flattenSteps(steps: WorkflowStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = []
  for (const s of steps) {
    result.push(s)
    if (s.type === 'parallel' && s.branches) {
      result.push(...s.branches)
    }
  }
  return result
}

// AI: 更新 StepLog 状态
function updateStepLog(
  exec: WorkflowExecution,
  stepId: string,
  patch: Partial<StepLog>
): WorkflowExecution {
  const now = new Date().toISOString()
  const updated: WorkflowExecution = {
    ...exec,
    updatedAt: now,
    steps: exec.steps.map((s) =>
      s.stepId === stepId ? { ...s, ...patch } : s
    ),
  }
  saveExecution(updated)
  return updated
}

// ─── 任务输出目录 ───────────────────────────────────────────────

function getStepOutputDir(taskId: string, stepId: string): string {
  return path.join(DATA_DIR, 'tasks', taskId, 'steps', stepId)
}

// ─── 单步执行 ───────────────────────────────────────────────

async function runAgentStep(
  exec: WorkflowExecution,
  step: WorkflowStep,
  task: Task,
  dataStore: DataStore
): Promise<WorkflowExecution> {
  // AI: 标记步骤为 running
  let updated = updateStepLog(exec, step.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  const agentName = step.agentName
  if (!agentName) {
    updated = updateStepLog(updated, step.id, {
      status: 'failed',
      error: `步骤 ${step.id} 未指定 agentName`,
      completedAt: new Date().toISOString(),
    })
    return updated
  }

  const agent = findAgent(agentName)
  if (!agent) {
    updated = updateStepLog(updated, step.id, {
      status: 'failed',
      error: `Agent "${agentName}" 未注册或已禁用`,
      completedAt: new Date().toISOString(),
    })
    return updated
  }

  const runner = getRunner(agent.runnerId)
  if (!runner) {
    updated = updateStepLog(updated, step.id, {
      status: 'failed',
      error: `Runner "${agent.runnerId}" 不存在`,
      completedAt: new Date().toISOString(),
    })
    return updated
  }

  const outputDir = getStepOutputDir(task.id, step.id)

  try {
    const result = await runner.run({ agent, task, outputDir })
    const stepStatus: StepStatus = result.success ? 'done' : 'failed'
    updated = updateStepLog(updated, step.id, {
      status: stepStatus,
      completedAt: new Date().toISOString(),
      error: result.error,
    })
  } catch (err) {
    updated = updateStepLog(updated, step.id, {
      status: 'failed',
      error: String(err),
      completedAt: new Date().toISOString(),
    })
  }

  return updated
}

// AI: 执行 parallel 步骤（并行运行所有 branches）
async function runParallelStep(
  exec: WorkflowExecution,
  step: WorkflowStep,
  task: Task,
  dataStore: DataStore
): Promise<WorkflowExecution> {
  let updated = updateStepLog(exec, step.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  const branches = step.branches ?? []
  if (branches.length === 0) {
    updated = updateStepLog(updated, step.id, {
      status: 'done',
      completedAt: new Date().toISOString(),
    })
    return updated
  }

  // AI: 并行执行所有分支（各分支独立运行，互不阻塞）
  const branchResults = await Promise.allSettled(
    branches.map((branch) => runAgentStep(updated, branch, task, dataStore))
  )

  // AI: 汇总分支结果，更新各分支 stepLog
  for (const res of branchResults) {
    if (res.status === 'fulfilled') {
      updated = {
        ...updated,
        steps: updated.steps.map((s) => {
          const branchStep = res.value.steps.find((bs) => bs.stepId === s.stepId)
          return branchStep ?? s
        }),
        updatedAt: new Date().toISOString(),
      }
    }
  }

  // AI: 所有分支完成（不论成败），父步骤标记为 done
  const allBranchIds = new Set(branches.map((b) => b.id))
  const branchLogs = updated.steps.filter((s) => allBranchIds.has(s.stepId))
  const anyFailed = branchLogs.some((s) => s.status === 'failed')

  updated = updateStepLog(updated, step.id, {
    status: anyFailed ? 'failed' : 'done',
    completedAt: new Date().toISOString(),
  })

  return updated
}

// AI: 处理 human_in_loop 步骤 — 暂停执行，等待人工操作
function pauseForHumanInput(
  exec: WorkflowExecution,
  step: WorkflowStep,
  task: Task
): WorkflowExecution {
  const updated = updateStepLog(exec, step.id, {
    status: 'waiting',
    startedAt: new Date().toISOString(),
    actions: step.actions,
  })

  // AI: 整体执行状态改为 waiting
  const waiting: WorkflowExecution = {
    ...updated,
    status: 'waiting',
    currentStepId: step.id,
    updatedAt: new Date().toISOString(),
  }
  saveExecution(waiting)

  // AI: 发送 Mac 通知（异步，不阻塞）
  if (step.notify) {
    channelManager.sendAll({
      title: 'Manta — 需要您的操作',
      body: `任务「${task.title}」步骤「${step.name}」需要您的审批`,
      taskId: task.id,
      action: 'approve',
    }).catch(() => {})
  }

  return waiting
}

// ─── 主执行循环 ───────────────────────────────────────────────

/**
 * AI: 启动工作流执行
 * - 创建 WorkflowExecution 实例
 * - 顺序执行步骤（parallel 并行，human_in_loop 暂停）
 */
export async function startWorkflow(
  task: Task,
  workflow: WorkflowDef,
  dataStore: DataStore
): Promise<WorkflowExecution> {
  let exec = createExecution(task, workflow)
  saveExecution(exec)

  // AI: 更新任务状态为 running
  await dataStore.updateTask(task.id, {
    status: 'running',
    workflowId: workflow.id,
    currentStepId: workflow.steps[0]?.id,
    startedAt: new Date().toISOString(),
  })

  exec = await advanceWorkflow(exec, task, workflow, dataStore)
  return exec
}

/**
 * AI: 推进工作流执行（从当前步骤开始，遇到 waiting 则停止）
 */
export async function advanceWorkflow(
  exec: WorkflowExecution,
  task: Task,
  workflow: WorkflowDef,
  dataStore: DataStore
): Promise<WorkflowExecution> {
  // AI: 找到当前步骤在步骤列表中的位置
  const steps = workflow.steps
  let currentStepId = exec.currentStepId ?? steps[0]?.id
  
  let updated = exec

  while (currentStepId) {
    const step = steps.find((s) => s.id === currentStepId)
    if (!step) break

    const currentLog = updated.steps.find((s) => s.stepId === step.id)
    
    // AI: 跳过已完成的步骤
    if (currentLog?.status === 'done' || currentLog?.status === 'skipped') {
      currentStepId = getNextStepId(step, steps)
      continue
    }

    // AI: 根据步骤类型执行
    if (step.type === 'human_in_loop') {
      updated = pauseForHumanInput(updated, step, task)
      // AI: human_in_loop 暂停，等待人工调用 /action 接口
      await dataStore.updateTask(task.id, { status: 'running', currentStepId: step.id })
      return updated
    }

    if (step.type === 'parallel') {
      updated = await runParallelStep(updated, step, task, dataStore)
    } else {
      // AI: 普通 agent 步骤
      updated = await runAgentStep(updated, step, task, dataStore)
    }

    // AI: 步骤失败时整体工作流也失败
    const stepLog = updated.steps.find((s) => s.stepId === step.id)
    if (stepLog?.status === 'failed') {
      const failed: WorkflowExecution = {
        ...updated,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }
      saveExecution(failed)
      await dataStore.updateTask(task.id, { status: 'failed', error: stepLog.error })
      return failed
    }

    currentStepId = getNextStepId(step, steps)
    if (currentStepId) {
      updated = { ...updated, currentStepId, updatedAt: new Date().toISOString() }
      saveExecution(updated)
      await dataStore.updateTask(task.id, { currentStepId })
    }
  }

  // AI: 所有步骤完成
  const done: WorkflowExecution = {
    ...updated,
    status: 'done',
    currentStepId: undefined,
    updatedAt: new Date().toISOString(),
  }
  saveExecution(done)
  await dataStore.updateTask(task.id, { status: 'done', completedAt: new Date().toISOString() })

  await channelManager.sendAll({
    title: 'Manta — 工作流完成',
    body: `任务「${task.title}」所有步骤执行完毕`,
    taskId: task.id,
  }).catch(() => {})

  return done
}

// AI: 获取下一步 stepId（按 step.next 跳转，或按顺序）
function getNextStepId(current: WorkflowStep, allSteps: WorkflowStep[]): string | undefined {
  if (current.next) return current.next
  const idx = allSteps.findIndex((s) => s.id === current.id)
  return allSteps[idx + 1]?.id
}

/**
 * AI: human_in_loop 步骤人工操作
 * - action: 操作 key（如 'approve'、'reject'、'score'）
 * - 返回推进后的执行状态
 */
export async function applyHumanAction(
  exec: WorkflowExecution,
  step: WorkflowStep,
  actionKey: string,
  workflow: WorkflowDef,
  task: Task,
  dataStore: DataStore
): Promise<WorkflowExecution> {
  // AI: 从 actions 映射找到目标 stepId
  const targetStepId = step.actions?.[actionKey]

  let updated = updateStepLog(exec, step.id, {
    status: 'done',
    completedAt: new Date().toISOString(),
  })

  // AI: 更新执行状态为 running
  updated = {
    ...updated,
    status: 'running',
    // AI: 如果 action 指定了跳转目标，则跳转；否则走正常 next
    currentStepId: targetStepId ?? getNextStepId(step, workflow.steps),
    updatedAt: new Date().toISOString(),
  }
  saveExecution(updated)

  // AI: 继续推进工作流
  return advanceWorkflow(updated, task, workflow, dataStore)
}
/*  end: 工作流执行引擎结束 */
