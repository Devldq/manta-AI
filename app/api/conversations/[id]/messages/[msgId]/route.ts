/* DELETE /api/conversations/[id]/messages/[msgId] — 删除单条消息 */
import { NextRequest, NextResponse } from 'next/server'
import { deleteMessage } from '@/core/conversation/store'

interface RouteContext {
  params: Promise<{ id: string; msgId: string }>
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id, msgId } = await params
  try {
    const ok = deleteMessage(id, msgId)
    if (!ok) return NextResponse.json({ error: '消息不存在' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
