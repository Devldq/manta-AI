/* Knowledge Base 单个操作 API — GET / PUT / DELETE */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'

// 临时模拟数据（与列表路由共享）
const mockKnowledgeBases = [
  {
    id: 'kb-1',
    name: '产品文档',
    description: 'Manta AI 产品文档和用户指南',
    providerId: 'sqlite-vec',
    config: {
      dimensions: 1536,
      similarityThreshold: 0.7,
      topK: 5,
    },
    documentCount: 12,
    chunkCount: 245,
    createdAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-20T15:30:00Z',
  },
  {
    id: 'kb-2',
    name: '技术规范',
    description: '系统架构和技术规范文档',
    providerId: 'sqlite-vec',
    config: {
      dimensions: 1536,
      similarityThreshold: 0.8,
      topK: 3,
    },
    documentCount: 8,
    chunkCount: 156,
    createdAt: '2024-01-10T08:00:00Z',
    updatedAt: '2024-01-18T12:00:00Z',
  },
]

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const knowledgeBase = mockKnowledgeBases.find((kb) => kb.id === id)

    if (!knowledgeBase) {
      throw Errors.NOT_FOUND('知识库', id)
    }

    return apiSuccess({ knowledgeBase })
  } catch (err) {
    return apiError(err)
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  return apiHandler(async () => {
    const { id } = await params
    const body = await req.json()

    const index = mockKnowledgeBases.findIndex((kb) => kb.id === id)
    if (index === -1) {
      throw Errors.NOT_FOUND('知识库', id)
    }

    // 更新知识库（模拟）
    const updatedKnowledgeBase = {
      ...mockKnowledgeBases[index],
      ...body,
      id, // 确保ID不变
      updatedAt: new Date().toISOString(),
    }

    mockKnowledgeBases[index] = updatedKnowledgeBase

    return { knowledgeBase: updatedKnowledgeBase }
  })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params
    const index = mockKnowledgeBases.findIndex((kb) => kb.id === id)

    if (index === -1) {
      throw Errors.NOT_FOUND('知识库', id)
    }

    // 删除知识库（模拟）
    mockKnowledgeBases.splice(index, 1)

    return apiSuccess({ success: true })
  } catch (err) {
    return apiError(err)
  }
}