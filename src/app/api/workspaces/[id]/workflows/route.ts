/* Workspace Workflows 绑定 API — POST 绑定 / DELETE 解绑 */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors, validateWithZod } from '@/core/api/error-handler'
import { BindEntitySchema } from '@/core/api/schemas/workspace.schema'
import { bindWorkflows, unbindWorkflows } from '@/core/services/workspace.service'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()
    const { entityIds } = validateWithZod(BindEntitySchema, body)
    const workspace = bindWorkflows(id, entityIds)
    if (!workspace) {
      throw Errors.NOT_FOUND('工作空间', id)
    }
    return { workspace }
  })
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()
    const { entityIds } = validateWithZod(BindEntitySchema, body)
    const workspace = unbindWorkflows(id, entityIds)
    if (!workspace) {
      throw Errors.NOT_FOUND('工作空间', id)
    }
    return { workspace }
  })
}