/* Workspace API — GET 列表 / POST 创建 */

import { NextRequest, NextResponse } from 'next/server'
import { listWorkspaces, createWorkspace } from '@/core/storage/workspace/store'

export async function GET() {
  try {
    const workspaces = listWorkspaces()
    return NextResponse.json({ workspaces })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.name?.trim()) {
      return NextResponse.json({ error: '工作空间名称不能为空' }, { status: 400 })
    }

    if (body.name.trim().length > 50) {
      return NextResponse.json({ error: '工作空间名称不能超过 50 个字符' }, { status: 400 })
    }

    const workspace = createWorkspace({
      name: body.name.trim(),
      description: body.description?.trim(),
    })

    return NextResponse.json({ workspace }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
