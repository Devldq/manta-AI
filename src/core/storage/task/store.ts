/* 任务存储层 — 支持双路径模式
 * 1. 独立任务（不归属工作空间）：~/.manta-data/tasks/{taskId}/task.json
 * 2. 工作空间任务（归属工作空间）：{workspaceFolder}/.manta/tasks/{taskId}/task.json
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { Task, TaskMessage, ToolCallRecord, StepUsageRecord } from '@/core/types'
import { shortId } from '../shared/fs-utils'

// ─── 路径计算 ───────────────────────────────────────────────

/** 系统目录：独立任务存储位置 */
function systemTasksDir(): string {
  return path.join(os.homedir(), '.manta-data', 'tasks')
}

/** 工作空间系统元数据目录（用于读取 workspace 的 folderPath）*/
function workspaceDataDir(): string {
  return path.join(os.homedir(), '.manta-data', 'workspaces')
}

/** 读取工作空间的 folderPath（从系统目录的 workspace.json）*/
function getWorkspaceFolderPath(workspaceId: string): string | null {
  try {
    const wsFilePath = path.join(workspaceDataDir(), workspaceId, 'workspace.json')
    if (!fs.existsSync(wsFilePath)) return null
    const ws = JSON.parse(fs.readFileSync(wsFilePath, 'utf-8')) as { folderPath?: string }
    return ws.folderPath ?? null
  } catch {
    return null
  }
}

/** 任务数据存储目录（根据是否归属工作空间决定路径）*/
function taskDataDir(taskId: string, workspaceId?: string): string {
  if (workspaceId) {
    const folderPath = getWorkspaceFolderPath(workspaceId)
    if (folderPath) {
      return path.join(folderPath, '.manta', 'tasks', taskId)
    }
    // 工作空间没有 folderPath 时，降级到系统目录
    return path.join(workspaceDataDir(), workspaceId, 'tasks', taskId)
  }
  return path.join(systemTasksDir(), taskId)
}

/** 任务 JSON 文件路径 */
function taskFilePath(taskId: string, workspaceId?: string): string {
  return path.join(taskDataDir(taskId, workspaceId), 'task.json')
}

/** 任务专属日志文件路径 */
export function getTaskLogPath(taskId: string, workspaceId?: string): string {
  return path.join(taskDataDir(taskId, workspaceId), 'log.ndjson')
}

// ─── 读写辅助 ───────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readTask(id: string, workspaceId?: string): Task | null {
  const fp = taskFilePath(id, workspaceId)
  if (!fs.existsSync(fp)) return null
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Task
  } catch {
    return null
  }
}

function writeTask(task: Task): void {
  const dir = taskDataDir(task.id, task.workspaceId)
  ensureDir(dir)
  const fp = path.join(dir, 'task.json')
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(task, null, 2), 'utf-8')
  fs.renameSync(tmp, fp)
}

// ─── 公开 API ───────────────────────────────────────────────

/** 创建新任务 */
export function createTask(agentName: string, title?: string, workspaceId?: string): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: uuidv4(),
    title: title ?? '新任务',
    agentName,
    messages: [],
    context: {},
    workspaceId,
    createdAt: now,
    updatedAt: now,
  }

  // 确保存储目录存在
  if (workspaceId) {
    const folderPath = getWorkspaceFolderPath(workspaceId)
    if (folderPath) {
      ensureDir(path.join(folderPath, '.manta', 'tasks'))
    } else {
      ensureDir(path.join(workspaceDataDir(), workspaceId, 'tasks'))
    }
  } else {
    ensureDir(systemTasksDir())
  }

  writeTask(task)
  return task
}

/** 获取任务列表
 * - 不传 workspaceId：返回所有独立任务（不归属任何工作空间）
 * - 传 workspaceId：返回该工作空间下的所有任务
 */
export function listTasks(workspaceId?: string): Task[] {
  const tasks: Task[] = []

  if (workspaceId) {
    // 读取工作空间下的任务
    const folderPath = getWorkspaceFolderPath(workspaceId)
    let tasksDir: string
    if (folderPath) {
      tasksDir = path.join(folderPath, '.manta', 'tasks')
    } else {
      tasksDir = path.join(workspaceDataDir(), workspaceId, 'tasks')
    }

    if (!fs.existsSync(tasksDir)) return []

    const entries = fs.readdirSync(tasksDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const task = readTask(entry.name, workspaceId)
      if (task) tasks.push(task)
    }
  } else {
    // 读取独立任务
    const dir = systemTasksDir()
    if (!fs.existsSync(dir)) return []

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const task = readTask(entry.name)
      if (task) tasks.push(task)
    }
  }

  return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** 获取单个任务 */
export function getTask(id: string, workspaceId?: string): Task | null {
  return readTask(id, workspaceId)
}

/** 更新任务标题 */
export function updateTaskTitle(id: string, title: string, workspaceId?: string): Task | null {
  const task = readTask(id, workspaceId)
  if (!task) return null
  task.title = title
  task.updatedAt = new Date().toISOString()
  writeTask(task)
  return task
}

/** 更新任务 agentName */
export function updateTaskAgent(id: string, agentName: string, workspaceId?: string): Task | null {
  const task = readTask(id, workspaceId)
  if (!task) return null
  task.agentName = agentName
  task.updatedAt = new Date().toISOString()
  writeTask(task)
  return task
}

/** 追加消息到任务，首条用户消息自动设为标题 */
export function appendMessage(
  taskId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  workspaceId?: string,
  toolCalls?: ToolCallRecord[],
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number },
  stepUsages?: StepUsageRecord[],
  agentAppId?: string,
): { task: Task; message: TaskMessage } | null {
  const task = readTask(taskId, workspaceId)
  if (!task) return null

  const msg: TaskMessage = {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
    ...(stepUsages && stepUsages.length > 0 ? { stepUsages } : {}),
    ...(agentAppId ? { agentAppId } : {}),
  }

  task.messages.push(msg)
  task.updatedAt = new Date().toISOString()

  // 首条用户消息自动设为标题
  if (role === 'user' && task.title === '新任务') {
    task.title = content.slice(0, 30) + (content.length > 30 ? '…' : '')
  }

  writeTask(task)
  return { task, message: msg }
}

/** 删除任务 */
export function deleteTask(id: string, workspaceId?: string): boolean {
  const dir = taskDataDir(id, workspaceId)
  if (!fs.existsSync(dir)) return false
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
