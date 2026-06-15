/* POST /api/conversations/[id]/messages — 发送消息（支持@调用） */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'
import { addMessage } from '@/core/services/conversation.service'
import { parseAtMentions } from '@/core/engine/at-mention-parser'
import { listApps } from '@/core/storage/app/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()

    // 解析@调用
    const apps = listApps()
    const mentions = parseAtMentions(body.content || '', apps)

    // 如果消息中包含@调用，将第一个@调用的应用ID添加到请求体
    if (mentions.length > 0 && !body.agentAppId) {
      body.agentAppId = mentions[0].agentAppId
    }

    const result = addMessage(id, body)
    if (!result) {
      throw Errors.NOT_FOUND('会话', id)
    }

    return {
      conversation: result.conversation,
      message: result.message,
      mentions,
    }
  })
}