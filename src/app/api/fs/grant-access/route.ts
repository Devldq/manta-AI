import { NextResponse } from 'next/server'
import { grantAccess, denyAccess } from '@security/fs-access'

/** POST { requestId, action: 'grant' | 'deny' } — 批准或拒绝授权请求 */
export async function POST(req: Request) {
  const { requestId, action } = await req.json()
  if (!requestId || typeof requestId !== 'string') {
    return NextResponse.json({ error: '缺少 requestId 参数' }, { status: 400 })
  }
  if (action !== 'grant' && action !== 'deny') {
    return NextResponse.json({ error: 'action 必须为 grant 或 deny' }, { status: 400 })
  }

  const ok = action === 'grant' ? grantAccess(requestId) : denyAccess(requestId)
  if (!ok) {
    return NextResponse.json({ error: `授权请求 ${requestId} 不存在` }, { status: 404 })
  }
  return NextResponse.json({ success: true, action })
}
