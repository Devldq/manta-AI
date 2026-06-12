import { NextResponse } from 'next/server'
import { listPendingRequests, requestAccess } from '@security/fs-access'

/** GET — 获取所有 pending 的授权请求 */
export async function GET() {
  return NextResponse.json(listPendingRequests())
}

/** POST { path } — 发起授权请求 */
export async function POST(req: Request) {
  const { path } = await req.json()
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ error: '缺少 path 参数' }, { status: 400 })
  }
  const request = requestAccess(path)
  return NextResponse.json(request)
}
