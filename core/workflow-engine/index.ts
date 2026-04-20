/*  start: Workflow Engine — 任务状态机 + 轻量模式/完整模式执行调度 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type {
  Task,
  TaskStatus,
  DataStore,
} from '../types'
import { getRunner } from '../runner'
import { channelManager } from '../channel'
import { findAgent } from '../../registry'

// ─── 数据存储（JSON 文件实现）───────────────────────────────────────────────

// AI: 数据目录使用 .manta-data（隐藏目录，符合 Unix/Linux 惯例）
const DATA_DIR = path.join(os.homedir(), '.manta-data')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')

// AI: 确保数据目录存在
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

// AI: 读取所有任务（兼容 1.0 旧格式，只保留符合 2.0 Task 接口的记录）
function readTasksRaw(): Task[] {
  ensureDataDir()
  if (!fs.existsSync(TASKS_FILE)) return []
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    // AI: 兼容旧格式 — 1.0 任务的 status 是大写（"Done"/"InProgress" 等），直接过滤掉
    const validStatuses = new Set(['inbox', 'planning', 'running', 'done', 'failed', 'archived'])
    const arr = Array.isArray(parsed) ? parsed : []
    return arr.filter((t: unknown) => {
      if (!t || typeof t !== 'object') return false
      const task = t as Record<string, unknown>
      return (
        typeof task.id === 'string' &&
        typeof task.title === 'string' &&
        typeof task.status === 'string' &&
        validStatuses.has(task.status) &&
        typeof task.createdAt === 'string'
      )
    }) as Task[]
  } catch {
    return []
  }
}

// AI: 写入所有任务（原子性写入，先写临时文件再重命名）
function writeTasksRaw(tasks: Task[]): void {
  ensureDataDir()
  const tmp = `${TASKS_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8')
  fs.renameSync(tmp, TASKS_FILE)
}

// ─── JSON 文件 DataStore 实现 ───────────────────────────────────────────────

class JsonFileDataStore implements DataStore {
  async getTasks(): Promise<Task[]> {
    return readTasksRaw()
  }

  async getTask(id: string): Promise<Task | null> {
    const tasks = readTasksRaw()
    return tasks.find((t) => t.id === id) ?? null
  }

  async createTask(
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Task> {
    const tasks = readTasksRaw()
    const now = new Date().toISOString()
    const task: Task = {
      ...taskData,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    }
    tasks.push(task)
    writeTasksRaw(tasks)
    return task
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const tasks = readTasksRaw()
    const idx = tasks.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error(`Task not found: ${id}`)
    const updated = {
      ...tasks[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    }
    tasks[idx] = updated
    writeTasksRaw(tasks)
    return updated
  }

  async deleteTask(id: string): Promise<void> {
    const tasks = readTasksRaw().filter((t) => t.id !== id)
    writeTasksRaw(tasks)
  }
}

// AI: 全局单例 DataStore
export const dataStore: DataStore = new JsonFileDataStore()

// ─── Workflow Engine ───────────────────────────────────────────────

// AI: 任务输出目录
function getTaskOutputDir(taskId: string): string {
  return path.join(DATA_DIR, 'tasks', taskId)
}

// AI: 执行轻量模式任务（Task → Runner → 结果）—— 导出供 /run API 复用
export async function runLightweightTask(task: Task): Promise<void> {
  if (!task.agentName) {
    await dataStore.updateTask(task.id, {
      status: 'failed',
      error: '轻量模式任务必须指定 agentName',
    })
    return
  }

  const agent = findAgent(task.agentName)
  if (!agent) {
    await dataStore.updateTask(task.id, {
      status: 'failed',
      error: `Agent "${task.agentName}" 未注册或已禁用`,
    })
    return
  }

  const runner = getRunner(agent.runnerId)
  if (!runner) {
    await dataStore.updateTask(task.id, {
      status: 'failed',
      error: `Runner "${agent.runnerId}" 不存在`,
    })
    return
  }

  // AI: 更新状态为 running
  await dataStore.updateTask(task.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  const outputDir = getTaskOutputDir(task.id)
  const result = await runner.run({ agent, task, outputDir })

  if (result.success) {
    await dataStore.updateTask(task.id, {
      status: 'done',
      outputDir,
      completedAt: new Date().toISOString(),
    })

    // AI: 任务完成后发 Mac 通知
    await channelManager.sendAll({
      title: 'Manta — 任务完成',
      body: `"${task.title}" 已由 ${task.agentName} 完成`,
      taskId: task.id,
    })
  } else {
    await dataStore.updateTask(task.id, {
      status: 'failed',
      error: result.error,
      completedAt: new Date().toISOString(),
    })

    await channelManager.sendAll({
      title: 'Manta — 任务失败',
      body: `"${task.title}" 执行失败: ${result.error?.slice(0, 100)}`,
      taskId: task.id,
    })
  }
}

// ─── 公共 API ───────────────────────────────────────────────

// AI: 创建并调度任务（非阻塞）
export async function createAndDispatch(
  taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Task> {
  const task = await dataStore.createTask({
    ...taskData,
    status: 'inbox',
  })

  // AI: 异步调度，不阻塞 API 响应
  if (task.mode === 'lightweight' && task.agentName) {
    setImmediate(() => {
      runLightweightTask(task).catch((err) => {
        console.error('[engine] dispatch error:', err)
        dataStore.updateTask(task.id, {
          status: 'failed',
          error: String(err),
        })
      })
    })
  } else if (task.mode === 'workflow' && task.workflowId) {
    // AI: 工作流模式 — 延迟导入避免循环依赖
    setImmediate(async () => {
      try {
        const { startWorkflow } = await import('./executor')
        const { findWorkflow } = await import('./loader')
        const workflow = findWorkflow(task.workflowId!)
        if (!workflow) {
          await dataStore.updateTask(task.id, {
            status: 'failed',
            error: `工作流 "${task.workflowId}" 不存在`,
          })
          return
        }
        await startWorkflow(task, workflow, dataStore)
      } catch (err) {
        console.error('[engine] workflow dispatch error:', err)
        dataStore.updateTask(task.id, {
          status: 'failed',
          error: String(err),
        })
      }
    })
  }

  return task
}

// AI: 手动推进任务状态
export async function advanceTaskStatus(
  taskId: string,
  newStatus: TaskStatus
): Promise<Task> {
  return dataStore.updateTask(taskId, { status: newStatus })
}
/*  end: Workflow Engine 结束 */
