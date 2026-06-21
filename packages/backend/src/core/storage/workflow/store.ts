import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { WorkflowDef } from '@core/types'
import { ensureDir, atomicWrite, shortId, readJsonFile } from '../shared/fs-utils'

const DATA_DIR = path.join(os.homedir(), '.manta-data', 'workflows')

function workflowDir(workflowId: string): string {
  return path.join(DATA_DIR, workflowId)
}

function workflowFilePath(workflowId: string): string {
  return path.join(workflowDir(workflowId), 'workflow.json')
}

/**
 * 获取所有工作流列表
 */
export function listWorkflows(): WorkflowDef[] {
  ensureDir(DATA_DIR)
  const workflows: WorkflowDef[] = []

  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const fp = workflowFilePath(entry.name)
      if (fs.existsSync(fp)) {
        try {
          const workflow = readJsonFile<WorkflowDef>(fp)
          if (workflow) {
            workflows.push(workflow)
          }
        } catch {
          // 跳过损坏的文件
        }
      }
    }
  } catch {
    // 目录不存在或无法读取
  }

  return workflows.sort((a, b) => {
    // 按名称排序
    return a.name.localeCompare(b.name)
  })
}

/**
 * 获取单个工作流
 */
export function getWorkflow(id: string): WorkflowDef | null {
  const fp = workflowFilePath(id)
  if (!fs.existsSync(fp)) return null

  try {
    return readJsonFile<WorkflowDef>(fp)
  } catch {
    return null
  }
}

/**
 * 创建新工作流
 */
export function createWorkflow(input: {
  name: string
  description?: string
  steps?: WorkflowDef['steps']
}): WorkflowDef {
  ensureDir(DATA_DIR)

  const id = shortId()
  const now = new Date().toISOString()

  const workflow: WorkflowDef = {
    id,
    name: input.name,
    description: input.description,
    steps: input.steps || [],
  }

  const dir = workflowDir(id)
  ensureDir(dir)
  atomicWrite(workflowFilePath(id), JSON.stringify(workflow, null, 2))

  return workflow
}

/**
 * 更新工作流
 */
export function updateWorkflow(
  id: string,
  patch: Partial<Omit<WorkflowDef, 'id'>>
): WorkflowDef | null {
  const existing = getWorkflow(id)
  if (!existing) return null

  const updated: WorkflowDef = {
    ...existing,
    ...patch,
    id, // 确保ID不变
  }

  atomicWrite(workflowFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 删除工作流
 */
export function deleteWorkflow(id: string): boolean {
  const dir = workflowDir(id)
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 检查工作流是否存在
 */
export function workflowExists(id: string): boolean {
  return fs.existsSync(workflowFilePath(id))
}