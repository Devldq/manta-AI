/* Workflow 单个操作 API — GET / PUT / DELETE */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'
import {
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from '@/core/storage/workflow/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const workflow = getWorkflow(id)

    if (!workflow) {
      throw Errors.NOT_FOUND('工作流', id)
    }

    return apiSuccess({ workflow })
  } catch (err) {
    return apiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()

    const workflow = updateWorkflow(id, body)
    if (!workflow) {
      throw Errors.NOT_FOUND('工作流', id)
    }

    return { workflow }
  })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const ok = deleteWorkflow(id)

    if (!ok) {
      throw Errors.NOT_FOUND('工作流', id)
    }

    return apiSuccess({ success: true })
  } catch (err) {
    return apiError(err)
  }
}