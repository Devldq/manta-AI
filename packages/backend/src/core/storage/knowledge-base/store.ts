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
import { ensureDir, atomicWrite, shortId, readJsonFile, removeDir } from '../shared/fs-utils'

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

// ─── 存储路径 ─────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), '.manta-data', 'knowledge-bases')

function kbFilePath(kbId: string): string {
  return path.join(DATA_DIR, `${kbId}.json`)
}

// ─── CRUD 函数 ────────────────────────────────────────────────

/**
 * 获取所有知识库列表（按 updatedAt 倒序）
 */
export function listKnowledgeBases(search?: string): KnowledgeBase[] {
  ensureDir(DATA_DIR)
  const knowledgeBases: KnowledgeBase[] = []

  try {
    const files = fs.readdirSync(DATA_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const fp = path.join(DATA_DIR, file)
      try {
        const kb = readJsonFile<KnowledgeBase>(fp)
        if (kb && kb.id) {
          knowledgeBases.push(kb)
        }
      } catch {
        // 跳过损坏的文件
      }
    }
  } catch {
    // 目录读取失败
  }

  // 搜索过滤
  let filtered = knowledgeBases
  if (search) {
    const lower = search.toLowerCase()
    filtered = knowledgeBases.filter(
      kb =>
        kb.name.toLowerCase().includes(lower) ||
        kb.description.toLowerCase().includes(lower),
    )
  }

  return filtered.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
}

/**
 * 获取单个知识库
 */
export function getKnowledgeBase(id: string): KnowledgeBase | null {
  return readJsonFile<KnowledgeBase>(kbFilePath(id))
}

/**
 * 创建新知识库
 */
export function createKnowledgeBase(input: CreateKnowledgeBaseInput): KnowledgeBase {
  ensureDir(DATA_DIR)

  const id = `kb-${shortId()}`
  const now = new Date().toISOString()

  const kb: KnowledgeBase = {
    id,
    name: input.name.trim(),
    description: input.description?.trim() || '',
    providerId: input.providerId || 'sqlite-vec',
    config: {
      dimensions: input.config?.dimensions || 1536,
      similarityThreshold: input.config?.similarityThreshold || 0.7,
      topK: input.config?.topK || 5,
      hybridSearch: input.config?.hybridSearch || {
        enabled: false,
        vectorWeight: 0.7,
        keywordWeight: 0.3,
      },
    },
    documentCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  }

  atomicWrite(kbFilePath(id), JSON.stringify(kb, null, 2))
  return kb
}

/**
 * 更新知识库
 */
export function updateKnowledgeBase(
  id: string,
  patch: UpdateKnowledgeBaseInput,
): KnowledgeBase | null {
  const existing = getKnowledgeBase(id)
  if (!existing) return null

  const updated: KnowledgeBase = {
    ...existing,
    ...patch,
    config: patch.config
      ? { ...existing.config, ...patch.config }
      : existing.config,
    id, // 确保 ID 不变
    updatedAt: new Date().toISOString(),
  }

  atomicWrite(kbFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/**
 * 删除知识库
 */
export function deleteKnowledgeBase(id: string): boolean {
  const fp = kbFilePath(id)
  try {
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp)
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * 检查知识库是否存在
 */
export function knowledgeBaseExists(id: string): boolean {
  return fs.existsSync(kbFilePath(id))
}
