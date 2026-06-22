/* GET /api/workspaces/[id]/tasks — 获取工作空间下的任务列表 */
import { NextRequest, NextResponse } from 'next/server'
import { fetchWorkspaceTasks } from '@/core/services/workspace.service'
import { Errors } from '@/core/api/error-handler'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const tasks = fetchWorkspaceTasks(id)
    return NextResponse.json({ tasks })
  } catch (err) {
    if (err === Errors.NOT_FOUND('工作空间', (await params).id)) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
