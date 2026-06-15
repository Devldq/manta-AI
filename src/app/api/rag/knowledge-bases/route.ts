/* Knowledge Bases API — GET 列表 / POST 创建 */

import { NextRequest } from 'next/server'
import { apiSuccess, apiError, apiHandler, Errors } from '@/core/api/error-handler'

// 临时模拟数据
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.toLowerCase()

    let knowledgeBases = [...mockKnowledgeBases]

    // 搜索过滤
    if (search) {
      knowledgeBases = knowledgeBases.filter(
        (kb) =>
          kb.name.toLowerCase().includes(search) ||
          kb.description.toLowerCase().includes(search)
      )
    }

    return apiSuccess({ knowledgeBases })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(req: NextRequest) {
  return apiHandler(async () => {
    const body = await req.json()

    // 验证必填字段
    if (!body.name?.trim()) {
      throw Errors.VALIDATION_ERROR('name', '知识库名称不能为空')
    }

    // 创建新知识库（模拟）
    const newKnowledgeBase = {
      id: `kb-${Date.now()}`,
      name: body.name.trim(),
      description: body.description?.trim() || '',
      providerId: body.providerId || 'sqlite-vec',
      config: {
        dimensions: body.config?.dimensions || 1536,
        similarityThreshold: body.config?.similarityThreshold || 0.7,
        topK: body.config?.topK || 5,
        hybridSearch: body.config?.hybridSearch || {
          enabled: false,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
        },
      },
      documentCount: 0,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // 添加到模拟数据
    mockKnowledgeBases.push(newKnowledgeBase)

    return { knowledgeBase: newKnowledgeBase }
  })
}