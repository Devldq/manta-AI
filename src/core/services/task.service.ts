import type { Task, TaskMessage, TaskType, CreateTaskInput } from '@/core/types'
import {
  createTask,
  listTasks,
  getTask,
  deleteTask,
  appendMessage,
} from '@/core/storage/task/store'
import { validateWithZod } from '@/core/api/error-handler'
import { CreateTaskSchema, SendMessageSchema } from '@/core/api/schemas/task.schema'

export function fetchTasks(params: { type: TaskType; workspaceId?: string }): Task[] {
  if (params.type === 'workspace' && params.workspaceId) {
    // 从工作空间存储获取
    return listTasks(params.workspaceId)
  }
  // 从全局存储获取（独立任务）
  return listTasks()
}

export function createNewTask(input: CreateTaskInput): Task {
  if (input.type === 'workspace' && input.workspaceId) {
    // 创建工作空间任务
    const task = createTask(input.agentName, input.title, input.workspaceId)
    if (!task) throw new Error('创建工作空间任务失败')
    return task
  }
  // 创建全局任务（独立任务）
  return createTask(input.agentName, input.title)
}

export function getTaskById(id: string, workspaceId?: string): Task | null {
  return getTask(id, workspaceId)
}

export function deleteExistingTask(id: string, type?: TaskType, workspaceId?: string): boolean {
  if (type === 'workspace' && workspaceId) {
    return deleteTask(id, workspaceId)
  }
  return deleteTask(id)
}

export function addMessage(
  taskId: string,
  input: unknown,
  workspaceId?: string,
): { task: Task; message: TaskMessage } | null {
  const data = validateWithZod(SendMessageSchema, input)
  const result = appendMessage(
    taskId,
    data.role as 'user' | 'assistant' | 'system',
    data.content,
    workspaceId,
    undefined,
    undefined,
    data.agentAppId
  )
  if (!result) return null
  return { task: result.task, message: result.message }
}
