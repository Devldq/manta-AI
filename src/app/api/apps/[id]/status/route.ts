/*  App 状态变更 API — PATCH /api/apps/[id]/status */

import { NextRequest, NextResponse } from 'next/server'
import { updateAppStatus } from '@/core/storage/app/store'
import type { AppStatus } from '@/core/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json()
    const status = body.status as AppStatus

    if (!['draft', 'published', 'archived'].includes(status)) {
      return NextResponse.json(
        { error: '无效的状态值，可选值：draft, published, archived' },
        { status: 400 }
      )
    }

    const updated = updateAppStatus(id, status)
    if (!updated) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 })
    }

    return NextResponse.json({ app: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
