import { NextResponse } from 'next/server'
import { sendMacNotification } from '@/lib/macNotify'
import { readJsonl, NOTIFICATIONS_FILE } from '@/lib/dataStore'
import type { Notification } from '@/lib/types'

// AI: POST /api/notify — 手动触发 Mac 通知
export async function POST(req: Request) {
  const { title, message, type, taskId, agentId } = await req.json()
  await sendMacNotification({ title, message, type, taskId, agentId })
  return NextResponse.json({ ok: true })
}

// AI: GET /api/notify — 获取通知历史
export async function GET() {
  const notifications = readJsonl<Notification>(NOTIFICATIONS_FILE)
  // AI: 最新的在前
  return NextResponse.json(notifications.reverse())
}
