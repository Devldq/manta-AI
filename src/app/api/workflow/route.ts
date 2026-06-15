/* Workflow API — GET 列表 / POST 创建 */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'
import {
  listWorkflows,
  createWorkflow,
} from '@/core/storage/workflow/store'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.toLowerCase()

    let workflows = listWorkflows()

    // 搜索过滤
    if (search) {
      workflows = workflows.filter(
        (wf) =>
          wf.name.toLowerCase().includes(search) ||
          (wf.description && wf.description.toLowerCase().includes(search))
      )
    }

    return apiSuccess({ workflows })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()

    // 验证必填字段
    if (!body.name?.trim()) {
      throw Errors.VALIDATION_ERROR('name', '工作流名称不能为空')
    }

    // 创建新工作流
    const workflow = createWorkflow({
      name: body.name.trim(),
      description: body.description?.trim(),
      steps: body.steps,
    })

    return { workflow }
  })
}