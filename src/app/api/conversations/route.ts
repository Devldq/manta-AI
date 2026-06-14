/* POST /api/conversations — 创建新会话, GET /api/conversations — 获取会话列表 */
import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler } from '@/core/api/error-handler'
import { fetchConversations, createNewConversation } from '@/core/services/conversation.service'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workspaceId = searchParams.get('workspaceId')

    const conversations = fetchConversations({
      workspaceId: workspaceId ?? undefined,
    })

    return apiSuccess({ conversations })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()
    const conversation = createNewConversation(body)
    return { conversation }
  })
}
