import { NextResponse } from 'next/server'
import { readJson, writeJson, TASKS_FILE, ensureDir } from '@/lib/dataStore'
import { triggerAgent, resolveAgentForTask, buildTriggerMessage } from '@/lib/agentTrigger'
import { loadWorkflow, initStepLogs, markCurrentStepRunning } from '@/lib/workflowEngine'
import type { Task, TaskStatus } from '@/lib/types'
import path from 'path'

// AI: GET /api/tasks — 获取任务列表，支持 status/workflowId/showDeleted/showAllDone 过滤，按 updatedAt 倒序
export async function GET(req: Request) {
  ensureDir(path.dirname(TASKS_FILE))
  const allTasks = readJson<Task[]>(TASKS_FILE, [])
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') as TaskStatus | null
  const workflowId = searchParams.get('workflowId')
  const showDeleted = searchParams.get('showDeleted') === 'true'   // AI: 是否展示已删除任务
  const showAllDone = searchParams.get('showAllDone') === 'true'   // AI: 是否展示全部已完成（含24h前的）
  const now = Date.now()
  const H24 = 24 * 60 * 60 * 1000  // AI: 24小时毫秒数

  const filtered = allTasks.filter(t => {
    // AI: 软删除过滤 — 默认隐藏已删除任务
    if (t.deletedAt && !showDeleted) return false
    // AI: 已完成超过 24h 自动隐藏，除非打开 showAllDone 开关
    if (t.status === 'Done' && !showAllDone && !showDeleted) {
      if (t.updatedAt && now - new Date(t.updatedAt).getTime() > H24) return false
    }
    if (status && t.status !== status) return false
    if (workflowId && t.workflowId !== workflowId) return false
    return true
  })

  // AI: 按 updatedAt 倒序排列（最近活跃的排前面）
  filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return NextResponse.json(filtered)
}

// AI: POST /api/tasks — 创建新任务，创建完成后异步触发对应 agent
export async function POST(req: Request) {
  ensureDir(path.dirname(TASKS_FILE))
  const body = await req.json()
  const tasks = readJson<Task[]>(TASKS_FILE, [])
  const now = new Date().toISOString()

  /* AI start: 如果绑定了工作流，自动初始化 workflowStep 和 stepLogs */
  let initialWorkflowStep: string | undefined
  let initialStepLogs = undefined
  if (body.workflowId) {
    const wf = loadWorkflow(body.workflowId)
    if (wf?.steps?.length) {
      initialWorkflowStep = wf.steps[0].id
      initialStepLogs = initStepLogs(wf)
      // AI: 第一步骤标记为 running（任务创建即触发 architect）
      const firstLog = initialStepLogs.find(l => l.stepId === initialWorkflowStep)
      if (firstLog) {
        firstLog.status = 'running'
        firstLog.startedAt = now
      }
    }
  }
  /* AI end */

  const newTask: Task = {
    id: crypto.randomUUID(),
    title: body.title ?? '未命名任务',
    description: body.description ?? '',
    workflowId: body.workflowId || undefined,      // AI: 不设默认工作流，普通任务无需绑定工作流
    workflowStep: initialWorkflowStep,              // AI: 初始化工作流游标到第一步骤
    stepLogs: initialStepLogs,                      // AI: 初始化工作流步骤日志
    assignedAgent: body.assignedAgent || undefined, // AI: 指定执行 agent，不指定则自动推断
    status: 'Inbox',
    requirementDoc: body.requirementDoc,
    backendDesign: body.backendDesign,
    repos: body.repos ?? [],
    createdAt: now,
    updatedAt: now,
    history: [],
  }
  tasks.push(newTask)
  writeJson(TASKS_FILE, tasks)

  /* AI start: 任务创建后异步触发 agent — 不阻塞 API 响应 */
  setImmediate(() => {
    try {
      // AI: 如果任务指定了 assignedAgent，直接触发；否则按规则推断
      const agentId = newTask.assignedAgent || resolveAgentForTask(newTask, 'Inbox')
      if (agentId) {
        const message = buildTriggerMessage(newTask, 'created')
        triggerAgent(agentId, message)
      }
    } catch (err) {
      console.error('[ARM] 任务创建触发 agent 失败:', err)
    }
  })
  /* AI end: 任务创建后异步触发 agent */

  return NextResponse.json(newTask, { status: 201 })
}
