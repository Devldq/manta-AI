/* Workspace 单个操作 API — GET / PUT / DELETE */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'
import { getWorkspaceById, updateExistingWorkspace, deleteExistingWorkspace } from '@/core/services/workspace.service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const workspace = getWorkspaceById(id)
    if (!workspace) {
      throw Errors.NOT_FOUND('工作空间', id)
    }
    return apiSuccess({ workspace })
  } catch (err) {
    return apiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()
    const workspace = updateExistingWorkspace(id, body)
    if (!workspace) {
      throw Errors.NOT_FOUND('工作空间', id)
    }
    return { workspace }
  })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const ok = deleteExistingWorkspace(id)
    if (!ok) {
      throw Errors.NOT_FOUND('工作空间', id)
    }
    return apiSuccess({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
