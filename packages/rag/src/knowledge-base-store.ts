/**
 * 知识库存储层 — 持久化 RAG 知识库配置
 *
 * 存储结构：
 *   ~/.manta-data/knowledge-bases/
 *     └── {id}.json   — 每个知识库一个 JSON 文件
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { shortId, readJsonFile, writeJsonFile, removeDir } from './fs-utils'

// ─── 类型定义 ─────────────────────────────────────────────────

export interface KnowledgeBaseConfig {
  dimensions: number
  similarityThreshold: number
  topK: number
  hybridSearch?: {
    enabled: boolean
    vectorWeight: number
    keywordWeight: number
  }
  /** 向量模型配置（可覆盖环境变量全局配置） */
  embeddingConfig?: {
    provider: 'openai' | 'local'
    model?: string
    apiKey?: string
    baseUrl?: string
    dimensions?: number
  }
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  providerId: string
  config: KnowledgeBaseConfig
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface CreateKnowledgeBaseInput {
  name: string
  description?: string
  providerId?: string
  config?: Partial<KnowledgeBaseConfig>
}

export interface UpdateKnowledgeBaseInput {
  name?: string
  description?: string
  providerId?: string
  config?: Partial<KnowledgeBaseConfig>
  documentCount?: number
  chunkCount?: number
}

// ─── 路径计算 ─────────────────────────────────────────────────

function getStorageDir(): string {
  return path.join(os.homedir(), '.manta-data', 'knowledge-bases')
}

function getFilePath(id: string): string {
  return path.join(getStorageDir(), `${id}.json`)
}

// ─── 默认配置 ─────────────────────────────────────────────────

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  dimensions: 1536,
  similarityThreshold: 0.7,
  topK: 5,
}

// ─── 工具函数 ─────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

// ─── CRUD 操作 ────────────────────────────────────────────────

/** 列出所有知识库，支持搜索过滤 */
export function listKnowledgeBases(search?: string): KnowledgeBase[] {
  const dir = getStorageDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const kbs: KnowledgeBase[] = []

  for (const file of files) {
    const data = readJsonFile<KnowledgeBase>(path.join(dir, file))
    if (data) {
      if (search) {
        const q = search.toLowerCase()
        if (!data.name.toLowerCase().includes(q) && !data.description?.toLowerCase().includes(q)) {
          continue
        }
      }
      kbs.push(data)
    }
  }

  return kbs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** 获取单个知识库 */
export function getKnowledgeBase(id: string): KnowledgeBase | null {
  return readJsonFile<KnowledgeBase>(getFilePath(id))
}

/** 创建知识库 */
export function createKnowledgeBase(input: CreateKnowledgeBaseInput): KnowledgeBase {
  const id = shortId()
  const timestamp = now()

  const config: KnowledgeBaseConfig = {
    ...DEFAULT_CONFIG,
    ...input.config,
  }

  const kb: KnowledgeBase = {
    id,
    name: input.name,
    description: input.description || '',
    providerId: input.providerId || 'sqlite-vec',
    config,
    documentCount: 0,
    chunkCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  writeJsonFile(getFilePath(id), kb)
  return kb
}

/** 更新知识库 */
export function updateKnowledgeBase(id: string, patch: UpdateKnowledgeBaseInput): KnowledgeBase | null {
  const kb = readJsonFile<KnowledgeBase>(getFilePath(id))
  if (!kb) return null

  if (patch.name !== undefined) kb.name = patch.name
  if (patch.description !== undefined) kb.description = patch.description
  if (patch.providerId !== undefined) kb.providerId = patch.providerId
  if (patch.documentCount !== undefined) kb.documentCount = patch.documentCount
  if (patch.chunkCount !== undefined) kb.chunkCount = patch.chunkCount

  if (patch.config) {
    kb.config = { ...kb.config, ...patch.config }
  }

  kb.updatedAt = now()
  writeJsonFile(getFilePath(id), kb)
  return kb
}

/** 删除知识库 */
export function deleteKnowledgeBase(id: string): boolean {
  const filePath = getFilePath(id)
  if (!fs.existsSync(filePath)) return false

  // 删除关联的数据目录
  const kbDir = path.join(os.homedir(), '.manta-data', 'rag', id)
  removeDir(kbDir)

  try {
    fs.unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

/** 检查知识库是否存在 */
export function knowledgeBaseExists(id: string): boolean {
  return fs.existsSync(getFilePath(id))
}
