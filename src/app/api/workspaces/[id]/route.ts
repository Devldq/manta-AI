/* Workspace 单个操作 API — GET / PUT / DELETE */

import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace, updateWorkspace, deleteWorkspace } from '@/core/storage/workspace/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const workspace = getWorkspace(id)
    if (!workspace) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }
    return NextResponse.json({ workspace })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()

    // 名称校验
    if (body.name !== undefined) {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: '工作空间名称不能为空' }, { status: 400 })
      }
      if (body.name.trim().length > 50) {
        return NextResponse.json({ error: '工作空间名称不能超过 50 个字符' }, { status: 400 })
      }
      body.name = body.name.trim()
    }

    const existing = getWorkspace(id)
    if (!existing) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }

    const updated = updateWorkspace(id, body)
    if (!updated) {
      return NextResponse.json({ error: '更新失败' }, { status: 500 })
    }

    return NextResponse.json({ workspace: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const ok = deleteWorkspace(id)
    if (!ok) {
      return NextResponse.json({ error: '工作空间不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
