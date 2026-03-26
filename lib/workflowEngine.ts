import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { WorkflowConfig, WorkflowStep, WorkflowStepLog, Task, TaskStatus, TaskHistoryEntry } from './types'
import { sendMacNotification } from './macNotify'
import { readJson, writeJson, TASKS_FILE } from './dataStore'

/* AI start: 工作流驱动引擎 — 读取 YAML 步骤定义，驱动任务在步骤间流转，维护每步骤的 stepLogs */

const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows')

// AI: 加载工作流 YAML 配置
export function loadWorkflow(workflowId: string): WorkflowConfig | null {
  const filePath = path.join(WORKFLOWS_DIR, `${workflowId}.yaml`)
  try {
    if (!fs.existsSync(filePath)) return null
    return yaml.load(fs.readFileSync(filePath, 'utf-8')) as WorkflowConfig
  } catch {
    return null
  }
}

// AI: 根据步骤 ID 找到步骤定义
export function findStep(workflow: WorkflowConfig, stepId: string): WorkflowStep | null {
  return workflow.steps.find(s => s.id === stepId) ?? null
}

// AI: 通用状态机校验（不依赖工作流）
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Inbox: ['InProgress', 'Cancelled'],
  InProgress: ['InProgress', 'Done', 'Blocked', 'Cancelled'], // AI: InProgress→InProgress 允许，用于步骤内更新
  Done: [],
  Blocked: ['InProgress', 'Cancelled'],
  Cancelled: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function validateTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `非法状态流转: ${from} → ${to}。允许的目标状态: [${VALID_TRANSITIONS[from]?.join(', ') || '无'}]`
    )
  }
}

// AI: advance-step 结果
export interface AdvanceResult {
  task: Task
  nextStep: WorkflowStep | null
  triggerAgentId: string | null   // 需要触发的 agent ID（parallel: 前缀表示并行）
  triggerMessage: string | null   // 触发消息
  notified: boolean               // 是否已发 Mac 通知
}

/* AI start: stepLogs 辅助函数 */

// AI: 初始化工作流所有步骤的 stepLogs（任务创建时调用）
export function initStepLogs(workflow: WorkflowConfig): WorkflowStepLog[] {
  const logs: WorkflowStepLog[] = []
  for (const step of workflow.steps) {
    if (step.parallel && step.branches) {
      // AI: 并行步骤 — 每个分支创建独立日志
      for (const branch of step.branches) {
        logs.push({
          stepId: `${step.id}:${branch.agent}`,
          stepName: `${branch.name}`,
          status: 'pending',
        })
      }
    } else {
      logs.push({
        stepId: step.id,
        stepName: step.name,
        status: 'pending',
        agentId: step.type === 'human_in_loop' ? 'you' : (step.agent ? `arm-${step.agent}` : undefined),
      })
    }
  }
  return logs
}

// AI: 标记某步骤开始运行
export function markStepRunning(task: Task, stepId: string, agentId?: string): void {
  if (!task.stepLogs) return
  const log = task.stepLogs.find(l => l.stepId === stepId || l.stepId.startsWith(`${stepId}:`))
  if (log) {
    log.status = 'running'
    log.startedAt = new Date().toISOString()
    if (agentId) log.agentId = agentId
  }
}

// AI: 标记某步骤完成
function markStepDone(task: Task, stepId: string, outputNote?: string): void {
  if (!task.stepLogs) return
  // AI: 处理并行分支（stepId 可能是 "parallel_review:qa" 格式）
  const logs = task.stepLogs.filter(l => l.stepId === stepId || l.stepId === `parallel_review:${stepId.split(':')[1]}`)
  const exactLog = task.stepLogs.find(l => l.stepId === stepId)
  const target = exactLog ?? logs[0]
  if (target) {
    target.status = 'done'
    target.completedAt = new Date().toISOString()
    if (outputNote) target.outputNote = outputNote
  }
}

// AI: 标记某步骤被退回（rejected）
function markStepRejected(task: Task, stepId: string, reason?: string): void {
  if (!task.stepLogs) return
  const log = task.stepLogs.find(l => l.stepId === stepId)
  if (log) {
    log.status = 'rejected'
    log.completedAt = new Date().toISOString()
    if (reason) log.error = reason
  }
}

// AI: 标记下一步骤为 running
function markNextStepRunning(task: Task, nextStep: WorkflowStep, agentId?: string): void {
  if (!task.stepLogs) return
  if (nextStep.parallel && nextStep.branches) {
    // AI: 并行步骤 — 所有分支标记为 running
    for (const branch of nextStep.branches) {
      const branchId = `${nextStep.id}:${branch.agent}`
      const log = task.stepLogs.find(l => l.stepId === branchId)
      if (log) {
        log.status = 'running'
        log.startedAt = new Date().toISOString()
        log.agentId = `arm-${branch.agent}`
      }
    }
  } else {
    const log = task.stepLogs.find(l => l.stepId === nextStep.id)
    if (log) {
      log.status = 'running'
      log.startedAt = new Date().toISOString()
      if (agentId) log.agentId = agentId
      else if (nextStep.type === 'human_in_loop') log.agentId = 'you'
      else if (nextStep.agent) log.agentId = `arm-${nextStep.agent}`
    }
  }
}

/* AI end: stepLogs 辅助函数 */

/**
 * AI: 核心 — 推进工作流到下一步，并维护 stepLogs
 * agent 完成当前步骤后调用此函数，驱动工作流前进：
 *  1. 确定当前步骤的 next 目标
 *  2. 更新 task.workflowStep 和 stepLogs
 *  3. 若下一步是 human_in_loop → 发 Mac 通知，不触发 agent
 *  4. 若下一步是 agent 步骤 → 返回需要触发的 agentId + message
 *  5. 若没有 next → 任务标记 Done
 */
export async function advanceWorkflowStep(
  taskId: string,
  completedStepId: string,
  outputNote: string,
  callerAgent: string,
  overrideNextStepId?: string,  // AI: 允许调用方（如审批接口）直接指定下一步，绕过 YAML next 字段
): Promise<AdvanceResult> {
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const idx = tasks.findIndex(t => t.id === taskId)
  if (idx === -1) throw new Error(`任务 ${taskId} 不存在`)

  const task = tasks[idx]
  const workflow = task.workflowId ? loadWorkflow(task.workflowId) : null

  // AI: 无工作流的普通任务，直接标记 Done
  if (!workflow) {
    task.status = 'Done'
    task.updatedAt = new Date().toISOString()
    task.history.push({
      from: 'InProgress',
      to: 'Done',
      agent: callerAgent,
      note: outputNote,
      timestamp: new Date().toISOString(),
    } as TaskHistoryEntry)
    writeJson(TASKS_FILE, tasks)
    return { task, nextStep: null, triggerAgentId: null, triggerMessage: null, notified: false }
  }

  // AI: 标记当前步骤已完成（处理普通步骤和并行分支）
  const baseStepId = completedStepId.split(':')[0]
  const currentStep = findStep(workflow, baseStepId)
  if (!currentStep) throw new Error(`步骤 ${baseStepId} 在工作流 ${workflow.id} 中不存在`)

  // AI: 并行步骤分支补全 — agent 可能只传 "parallel_review"，需补全为 "parallel_review:qa"
  // callerAgent 格式为 "arm-qa" / "arm-review"，取去掉 arm- 前缀的部分作为分支 key
  let resolvedCompletedStepId = completedStepId
  if (currentStep.parallel && currentStep.branches && !completedStepId.includes(':')) {
    const agentSuffix = callerAgent.startsWith('arm-') ? callerAgent.slice(4) : callerAgent
    const matchingBranch = currentStep.branches.find(b => b.agent === agentSuffix)
    if (matchingBranch) {
      resolvedCompletedStepId = `${baseStepId}:${agentSuffix}`
    }
  }

  // AI: 更新 stepLog：当前步骤完成
  markStepDone(task, resolvedCompletedStepId, outputNote)

  // AI: 处理并行步骤（parallel_review）：需要所有分支都完成才能推进
  if (currentStep.parallel && currentStep.branches) {
    const allDone = checkParallelBranchesDone(task, currentStep)
    if (!allDone) {
      // AI: 还有分支未完成，保存进度，等待其他分支
      task.updatedAt = new Date().toISOString()
      writeJson(TASKS_FILE, tasks)
      return { task, nextStep: null, triggerAgentId: null, triggerMessage: null, notified: false }
    }
  }

  // AI: 确定下一步：优先用调用方传入的 overrideNextStepId（如审批 actions），否则按 YAML next/after_all
  const nextStepId = overrideNextStepId
    ?? (currentStep.parallel ? currentStep.after_all : currentStep.next)
  // AI: 'done' 是特殊值，表示直接结束任务
  const nextStep = (nextStepId && nextStepId !== 'done') ? findStep(workflow, nextStepId) : null

  // AI: 回写当前步骤的产出物路径到 task 对应字段（供后续步骤作为输入）
  updateTaskOutputFields(task, baseStepId, outputNote)

  // AI: 记录历史
  const historyEntry: TaskHistoryEntry = {
    from: task.status,
    to: nextStep ? 'InProgress' : 'Done',
    agent: callerAgent,
    note: outputNote,
    timestamp: new Date().toISOString(),
  }
  task.history.push(historyEntry)
  task.workflowStep = nextStepId ?? undefined
  task.status = nextStep ? 'InProgress' : 'Done'
  task.updatedAt = new Date().toISOString()

  // AI: 标记下一步为 running（如有）
  if (nextStep) {
    const nextAgentId = nextStep.type === 'human_in_loop' ? 'you' : (nextStep.agent ? `arm-${nextStep.agent}` : undefined)
    markNextStepRunning(task, nextStep, nextAgentId)
  }

  writeJson(TASKS_FILE, tasks)

  // AI: 无下一步 → 任务完成
  if (!nextStep) {
    return { task, nextStep: null, triggerAgentId: null, triggerMessage: null, notified: false }
  }

  // AI: 下一步是人工审批 → 发 Mac 通知，等待人工操作
  if (nextStep.type === 'human_in_loop') {
    const notifMsg = getNotificationMessage(workflow, nextStepId!, task)
    await sendMacNotification({
      title: `📋 ${nextStep.name}`,
      message: notifMsg,
      taskId,
      type: 'approval',
    })
    return { task, nextStep, triggerAgentId: null, triggerMessage: null, notified: true }
  }

  // AI: 下一步是并行步骤 → 为每个 branch 生成独立消息，包含正确的 completedStep 标识
  if (nextStep.parallel && nextStep.branches) {
    const agentList = nextStep.branches.map(b => `arm-${b.agent}`).join(',')
    // AI: 构建包含每个 branch 专属 completedStep 的消息 Map，格式: "arm-qa=消息|arm-review=消息"
    const branchMessages = nextStep.branches
      .map(b => `arm-${b.agent}=${buildBranchStepMessage(task, nextStep, b.agent)}`)
      .join('|||')
    return {
      task,
      nextStep,
      triggerAgentId: `parallel:${agentList}`,
      triggerMessage: branchMessages,  // AI: 使用 ||| 分隔的专属消息
      notified: false,
    }
  }

  // AI: 下一步是普通 agent 步骤 → 返回触发信息
  const nextAgentId = nextStep.agent ? `arm-${nextStep.agent}` : null
  return {
    task,
    nextStep,
    triggerAgentId: nextAgentId,
    triggerMessage: nextAgentId ? buildStepMessage(task, nextStep) : null,
    notified: false,
  }
}

/**
 * AI: agent 认领任务时调用 — 更新对应步骤的 stepLog 为 running 状态
 * 在 status API（Inbox→InProgress）时同步调用
 */
export function markCurrentStepRunning(task: Task, agentId: string): void {
  if (!task.workflowStep || !task.stepLogs) return
  markStepRunning(task, task.workflowStep, agentId)
}

/* AI start: 根据完成的步骤，将产出文件路径回写到 task 对应字段，供后续步骤读取 */
function updateTaskOutputFields(task: Task, completedStepId: string, outputNote?: string): void {
  const dataDir = `~/arm-data/tasks/${task.id}`
  switch (completedStepId) {
    case 'architecting':
      if (!task.frontendDesign) task.frontendDesign = `${dataDir}/frontend-design.md`
      break
    case 'developing':
      if (!task.devSummary) task.devSummary = `${dataDir}/dev-summary.md`
      break
    case 'parallel_review':
      if (!task.qaReport) task.qaReport = `${dataDir}/qa-report.md`
      if (!task.reviewReport) task.reviewReport = `${dataDir}/cr-report.md`
      break
    default:
      break
  }
}
/* AI end: 产出字段回写 */

// AI: 检查并行步骤所有分支是否都已完成（基于 stepLogs）
function checkParallelBranchesDone(task: Task, step: WorkflowStep): boolean {
  if (!step.branches) return true

  // AI: 优先用 stepLogs 检查（更准确）
  if (task.stepLogs) {
    return step.branches.every(branch => {
      const branchId = `${step.id}:${branch.agent}`
      const log = task.stepLogs!.find(l => l.stepId === branchId)
      return log?.status === 'done'
    })
  }

  // AI: 降级到文件存在检查
  const dataDir = path.join(
    process.env.ARM_DATA_ROOT
      ? process.env.ARM_DATA_ROOT.replace('~', process.env.HOME ?? '')
      : `${process.env.HOME}/arm-data`,
    'tasks',
    task.id,
  )
  const outputFiles: Record<string, string> = {
    qa: 'qa-report.md',
    review: 'cr-report.md',
  }
  return step.branches.every(branch => {
    const file = outputFiles[branch.agent]
    return file ? fs.existsSync(path.join(dataDir, file)) : true
  })
}

// AI: 为并行分支 agent 构建专属触发消息，包含正确的 completedStep（格式：stepId:agentSuffix）
function buildBranchStepMessage(task: Task, step: WorkflowStep, branchAgent: string): string {
  const repoList = task.repos?.length ? task.repos.join(', ') : '未指定'
  const dataDir = `~/arm-data/tasks/${task.id}`
  const branchDef = step.branches?.find(b => b.agent === branchAgent)
  const branchName = branchDef?.name ?? step.name
  // AI: completedStep 使用 "stepId:agentSuffix" 格式，引擎据此自动匹配分支 stepLog
  const completedStepKey = `${step.id}:${branchAgent}`

  const context = [
    `任务ID: ${task.id}`,
    `任务标题: ${task.title}`,
    task.description ? `任务描述: ${task.description}` : null,
    `当前工作流步骤: ${step.id}（${branchName}）`,
    task.requirementDoc ? `需求文档: ${task.requirementDoc}` : null,
    task.backendDesign ? `后端技术方案: ${task.backendDesign}` : null,
    task.frontendDesign ? `前端技术方案: ${task.frontendDesign}` : `前端技术方案: ${dataDir}/frontend-design.md（如存在）`,
    task.devSummary ? `开发摘要: ${task.devSummary}` : null,
    `关联仓库: ${repoList}`,
    `任务归档目录: ${dataDir}`,
    '',
    `输入材料：${(branchDef?.inputs ?? step.inputs ?? []).join(', ')}`,
  ].filter(s => s !== null).join('\n')

  return `你的并行工作步骤已就绪：${branchName}\n\n${context}\n\n完成后调用：\nPOST /api/tasks/${task.id}/advance-step\n` +
    `Body: {"completedStep": "${completedStepKey}", "outputNote": "完成说明", "agent": "arm-${branchAgent}"}\n\n` +
    `⚠️ completedStep 必须使用 "${completedStepKey}"（含分支标识），引擎据此判断所有分支是否都已完成。`
}

// AI: 构建给 agent 的工作步骤触发消息
function buildStepMessage(task: Task, step: WorkflowStep): string {
  const repoList = task.repos?.length ? task.repos.join(', ') : '未指定'
  const dataDir = `~/arm-data/tasks/${task.id}`

  const context = [
    `任务ID: ${task.id}`,
    `任务标题: ${task.title}`,
    task.description ? `任务描述: ${task.description}` : null,
    `当前工作流步骤: ${step.id}（${step.name}）`,
    task.requirementDoc ? `需求文档: ${task.requirementDoc}` : null,
    task.backendDesign ? `后端技术方案: ${task.backendDesign}` : null,
    task.frontendDesign ? `前端技术方案: ${task.frontendDesign}` : `前端技术方案: ${dataDir}/frontend-design.md（如存在）`,
    task.devSummary ? `开发摘要: ${task.devSummary}` : null,
    `关联仓库: ${repoList}`,
    `任务归档目录: ${dataDir}`,
    '',
    `输入材料：${(step.inputs ?? []).join(', ')}`,
    `产出要求：${(step.outputs ?? []).join(', ')}`,
  ].filter(s => s !== null).join('\n')

  return `你的下一个工作步骤已就绪：${step.name}\n\n${context}\n\n请按 SOUL.md 中的工作循环执行此步骤，完成后调用 POST /api/tasks/${task.id}/advance-step。`
}

// AI: 获取工作流通知消息（替换模板变量）
function getNotificationMessage(workflow: WorkflowConfig, stepId: string, task: Task): string {
  const key = `on_${stepId}`
  const template = workflow.notifications?.[key]?.message
  if (!template) return `${task.title} 需要你的操作`
  return template
    .replace('{task.title}', task.title)
    .replace('{task.id}', task.id)
}

/* AI end: 工作流驱动引擎 */
