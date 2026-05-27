/* POST /api/conversations/[id]/stop — 停止当前会话的 Agent Loop */
import { NextRequest } from 'next/server'
import { stopLoop } from '@/core/chat/loop-registry'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const stopped = stopLoop(id)

  return new Response(JSON.stringify({ stopped }), {
    status: stopped ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  })
}
