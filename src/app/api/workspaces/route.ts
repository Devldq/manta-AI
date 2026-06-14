/* Workspace API — GET 列表 / POST 创建 */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler } from '@/core/api/error-handler'
import { fetchWorkspaces, createNewWorkspace } from '@/core/services/workspace.service'

export async function GET() {
  try {
    const workspaces = fetchWorkspaces()
    return apiSuccess({ workspaces })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()
    const workspace = createNewWorkspace(body)
    return { workspace }
  })
}
