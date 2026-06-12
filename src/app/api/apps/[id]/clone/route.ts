/*  App 复制 API — POST /api/apps/[id]/clone */

import { NextRequest, NextResponse } from 'next/server'
import { cloneApp } from '@/core/storage/app/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const cloned = cloneApp(id, body.name)
    if (!cloned) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 })
    }
    return NextResponse.json({ app: cloned }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
