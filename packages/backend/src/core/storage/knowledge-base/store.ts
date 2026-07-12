/**
 * 知识库存储层 — 持久化 RAG 知识库配置
 *
 * 存储结构：
 *   ASH knowledge/knowledge-bases/
 *     └── {id}.json   — 每个知识库一个 JSON 文件
 */

import * as fs from 'fs'
import * as path from 'path'
import { resolveStoragePath } from '../../../storage/path-routing'
import { shortId, readJsonFile, removeDir } from '@manta/rag'
import { recoverAtomicBundle, writeAtomicBundle, withAtomicBundle } from '../../../storage/atomic-record-bundle'

// ─── 类型定义 ─────────────────────────────────────────────────

export interface ChunkingConfig {
  /** 分块策略：fixed=固定长度, semantic=语义, recursive=递归多级 */
  strategy: 'fixed' | 'semantic' | 'recursive'
  /** 分块大小（Token 数） */
  chunkSize: number
  /** 重叠大小（Token 数） */
  overlap: number
  /** 批量上传并行处理数（1-5） */
  batchConcurrency?: number
}

export interface KnowledgeBaseConfig {
  dimensions: number
  similarityThreshold: number
  topK: number
  hybridSearch?: {
    enabled: boolean
    vectorWeight: number
    keywordWeight: number
  }
  /** 向量模型配置（优先于环境变量） */
  embeddingConfig?: {
    provider: 'openai' | 'local'
    model?: string
    apiKey?: string
    baseUrl?: string
    dimensions?: number
  }
  /** 分块配置（用于文档处理时生效） */
  chunkingConfig?: ChunkingConfig
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
  clearEmbeddingApiKey?: boolean
}

// ─── 路径计算 ─────────────────────────────────────────────────

function getStorageDir(): string {
  return resolveStoragePath('knowledge', 'knowledge-bases')
}

function getFilePath(id: string): string {
  return path.join(getStorageDir(), `${id}.json`)
}

function getSecretPath(id: string): string {
  return resolveStoragePath('secrets', 'knowledge-base-api-keys', `${id}.json`)
}
function getBundleCoordinator(id: string): string { return resolveStoragePath('secrets', '.transactions', `knowledge-base-${id}`) }
const secretsRoot = () => resolveStoragePath('secrets')
const sealedPath = (id: string) => `knowledge-bases/${id}.sealed.json`

function readKnowledgeBase(id: string): KnowledgeBase | null {
  const sealed = withAtomicBundle(secretsRoot(), `knowledge-base-${id}`, (bundle) => bundle.read(sealedPath(id)))
  if (sealed) return JSON.parse(sealed) as KnowledgeBase
  recoverAtomicBundle(getBundleCoordinator(id))
  const kb = readJsonFile<KnowledgeBase>(getFilePath(id))
  if (!kb?.config.embeddingConfig) return kb
  const secret = readJsonFile<{ apiKey?: string }>(getSecretPath(id))
  return { ...kb, config: { ...kb.config, embeddingConfig: { ...kb.config.embeddingConfig, apiKey: secret?.apiKey } } }
}

function persistKnowledgeBase(kb: KnowledgeBase, clearApiKey = false): void {
  const embedding = kb.config.embeddingConfig
  if (!embedding) {
    withAtomicBundle(secretsRoot(), `knowledge-base-${kb.id}`, (bundle) => bundle.write(sealedPath(kb.id), JSON.stringify(kb, null, 2)))
    writeAtomicBundle({ coordinatorPath: getBundleCoordinator(kb.id), writes: new Map([[getFilePath(kb.id), JSON.stringify(kb, null, 2)]]) })
    return
  }
  let sanitized: KnowledgeBase & { config: KnowledgeBaseConfig & { embeddingConfig?: KnowledgeBaseConfig['embeddingConfig'] & { apiKeyRef?: string } } }; let nextApiKey: string | undefined
  withAtomicBundle(secretsRoot(), `knowledge-base-${kb.id}`, (bundle) => {
  const existing = bundle.read(sealedPath(kb.id)); const previousSecret = existing ? (JSON.parse(existing) as KnowledgeBase).config.embeddingConfig?.apiKey : readJsonFile<{ apiKey?: string }>(getSecretPath(kb.id))?.apiKey
  const { apiKey, ...preferences } = embedding
  nextApiKey = clearApiKey ? undefined : apiKey ?? previousSecret
  sanitized = {
    ...kb,
    config: { ...kb.config, embeddingConfig: nextApiKey ? { ...preferences, apiKeyRef: `knowledge-base:${kb.id}` } : preferences },
  }
  bundle.write(sealedPath(kb.id), JSON.stringify({ ...sanitized, config: { ...sanitized.config, embeddingConfig: { ...sanitized.config.embeddingConfig, apiKey: nextApiKey } } }, null, 2))
  })
  writeAtomicBundle({ coordinatorPath: getBundleCoordinator(kb.id), writes: new Map([
    [getSecretPath(kb.id), JSON.stringify(nextApiKey ? { apiKey: nextApiKey } : {}, null, 2)],
    [getFilePath(kb.id), JSON.stringify(sanitized!, null, 2)],
  ]) })
}

// ─── 默认配置 ─────────────────────────────────────────────────

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  dimensions: 1536,
  similarityThreshold: 0.7,
  topK: 5,
  chunkingConfig: {
    strategy: 'recursive',
    chunkSize: 512,
    overlap: 50,
  },
}

// ─── 工具函数 ─────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

// ─── CRUD 操作 ────────────────────────────────────────────────

export function listKnowledgeBases(search?: string): KnowledgeBase[] {
  const dir = getStorageDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const kbs: KnowledgeBase[] = []

  for (const file of files) {
    const data = readKnowledgeBase(path.basename(file, '.json'))
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

export function getKnowledgeBase(id: string): KnowledgeBase | null {
  return readKnowledgeBase(id)
}

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

  persistKnowledgeBase(kb)
  return kb
}

export function updateKnowledgeBase(id: string, patch: UpdateKnowledgeBaseInput): KnowledgeBase | null {
  const kb = readKnowledgeBase(id)
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
  persistKnowledgeBase(kb, patch.clearEmbeddingApiKey === true)
  return kb
}

export function deleteKnowledgeBase(id: string): boolean {
  const filePath = getFilePath(id)
  if (!fs.existsSync(filePath)) return false

  const kbDir = resolveStoragePath('knowledge', 'rag', id)
  removeDir(kbDir)

  try {
    withAtomicBundle(secretsRoot(), `knowledge-base-${id}`, (bundle) => bundle.delete(sealedPath(id)))
    writeAtomicBundle({ coordinatorPath: getBundleCoordinator(id), writes: new Map(), deletes: [filePath, getSecretPath(id)] })
    return true
  } catch {
    return false
  }
}

export function knowledgeBaseExists(id: string): boolean {
  return fs.existsSync(getFilePath(id))
}
