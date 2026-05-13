/* GET/DELETE /api/conversations/[id] */
import { NextRequest, NextResponse } from 'next/server'
import { getConversation, deleteConversation } from '@/core/conversation/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const conv = getConversation(id)
    if (!conv) return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    return NextResponse.json({ conversation: conv })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const ok = deleteConversation(id)
    if (!ok) return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
