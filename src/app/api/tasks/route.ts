/* POST /api/tasks — 创建新任务, GET /api/tasks — 获取任务列表 */
import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler } from '@/core/api/error-handler'
import { fetchTasks, createNewTask } from '@/core/services/task.service'
import type { TaskType } from '@/core/types'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type = (searchParams.get('type') as TaskType) || 'global'
    const workspaceId = searchParams.get('workspaceId') ?? undefined

    const tasks = fetchTasks({ type, workspaceId })

    return apiSuccess({ tasks })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()
    const task = createNewTask({
      ...body,
      type: body.type || 'global',
    })
    return { task }
  })
}
