/**
 * Embedding 缓存 — 避免对相同内容重复计算 Embedding
 *
 * 设计：
 * - 使用 SHA-256 哈希作为缓存 key（基于文本内容 + 模型标识）
 * - 缓存存储在独立的 SQLite 数据库中
 * - 支持模型变更时自动失效（通过 model 字段区分）
 * - 支持 LRU 淘汰和过期清理
 */

import Database from 'better-sqlite3'
import crypto from 'crypto'
import * as path from 'path'
import * as os from 'os'
import { ensureDir } from './fs-utils'
import type { EmbeddingService } from './types'

/**
 * 计算文本的 SHA-256 哈希（用于缓存 key）
 */
function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Embedding 缓存管理器
 * 负责缓存的读写、清理
 */
export class EmbeddingCacheManager {
  private db!: Database.Database
  private initialized = false
  private dbPath: string
  private maxEntries: number

  /**
   * @param cacheDir - 缓存目录（可选，默认为 ~/.manta-data/rag/cache）
   * @param maxEntries - 最大缓存条目数（可选，默认 100000）
   */
  constructor(cacheDir?: string, maxEntries?: number) {
    const dir = cacheDir || path.join(os.homedir(), '.manta-data', 'rag', 'cache')
    this.dbPath = path.join(dir, 'embedding-cache.db')
    this.maxEntries = maxEntries || 100000
  }

  /**
   * 初始化（懒加载）
   */
  private ensureInitialized(): void {
    if (this.initialized) return

    ensureDir(path.dirname(this.dbPath))

    this.db = new Database(this.dbPath)

    // 性能优化
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('cache_size = -32000') // 32MB cache

    // 创建缓存表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding_json TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 1,
        last_access_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (content_hash, model)
      )
    `)

    // 索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_model
      ON embedding_cache(model)
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_last_access
      ON embedding_cache(last_access_at)
    `)

    this.initialized = true
  }

  /**
   * 查找缓存
   * @returns 缓存的 embedding，未命中返回 null
   */
  get(text: string, model: string): number[] | null {
    this.ensureInitialized()

    const contentHash = hashContent(text)

    const row = this.db.prepare(`
      SELECT embedding_json, access_count FROM embedding_cache
      WHERE content_hash = ? AND model = ?
    `).get(contentHash, model) as { embedding_json: string; access_count: number } | undefined

    if (!row) return null

    // 更新访问计数和最后访问时间
    this.db.prepare(`
      UPDATE embedding_cache
      SET access_count = access_count + 1, last_access_at = datetime('now')
      WHERE content_hash = ? AND model = ?
    `).run(contentHash, model)

    try {
      return JSON.parse(row.embedding_json) as number[]
    } catch {
      return null
    }
  }

  /**
   * 批量查找缓存
   * @returns 与输入等长的数组，命中则返回 embedding，未命中返回 null
   */
  getBatch(texts: string[], model: string): (number[] | null)[] {
    return texts.map((text) => this.get(text, model))
  }

  /**
   * 写入缓存
   */
  set(text: string, model: string, embedding: number[]): void {
    this.ensureInitialized()

    const contentHash = hashContent(text)
    const dimensions = embedding.length
    const embeddingJson = JSON.stringify(embedding)

    // 写入或替换缓存
    this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache
      (content_hash, model, dimensions, embedding_json, access_count, last_access_at, created_at)
      VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(contentHash, model, dimensions, embeddingJson)

    // 检查是否需要清理（LRU 淘汰）
    this.evictIfNeeded()
  }

  /**
   * 批量写入缓存
   */
  setBatch(texts: string[], model: string, embeddings: number[][]): void {
    for (let i = 0; i < texts.length; i++) {
      this.set(texts[i], model, embeddings[i])
    }
  }

  /**
   * LRU 淘汰：如果缓存条目超过 maxEntries，删除最久未访问的条目
   */
  private evictIfNeeded(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as { count: number }).count

    if (count > this.maxEntries) {
      const deleteCount = count - this.maxEntries + 1000 // 多删 1000 条，减少频繁删除
      this.db.prepare(`
        DELETE FROM embedding_cache
        WHERE rowid IN (
          SELECT rowid FROM embedding_cache
          ORDER BY last_access_at ASC
          LIMIT ?
        )
      `).run(deleteCount)
    }
  }

  /**
   * 删除指定模型的所有缓存（模型变更时调用）
   */
  clearByModel(model: string): void {
    this.ensureInitialized()
    this.db.prepare('DELETE FROM embedding_cache WHERE model = ?').run(model)
  }

  /**
   * 删除所有缓存
   */
  clearAll(): void {
    this.ensureInitialized()
    this.db.prepare('DELETE FROM embedding_cache').run()
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    totalEntries: number
    modelCounts: { model: string; count: number; dimensions: number }[]
    cacheSizeBytes: number
  } {
    this.ensureInitialized()

    const totalEntries = (this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as { count: number }).count

    const modelCounts = this.db.prepare(`
      SELECT model, dimensions, COUNT(*) as count
      FROM embedding_cache
      GROUP BY model, dimensions
      ORDER BY count DESC
    `).all() as { model: string; dimensions: number; count: number }[]

    // 估算缓存文件大小
    const stats = this.db.prepare(`
      SELECT SUM(LENGTH(embedding_json)) as total_bytes FROM embedding_cache
    `).get() as { total_bytes: number | null }

    return {
      totalEntries,
      modelCounts,
      cacheSizeBytes: stats?.total_bytes || 0,
    }
  }

  /**
   * 清理超过指定小时数未访问的缓存条目
   * @param oldThanHours - 小时数，如 1 表示清理1小时未访问的缓存
   */
  cleanup(oldThanHours: number): void {
    this.ensureInitialized()

    this.db.prepare(`
      DELETE FROM embedding_cache
      WHERE last_access_at < datetime('now', '-' || ? || ' hours')
    `).run(oldThanHours)
  }

  /**
   * 预热缓存（从持久化存储加载热数据）
   */
  preload(model: string, limit: number = 1000): void {
    // 这个方法可以用于启动时预热缓存
    // 由于我们使用 SQLite 作为缓存存储，数据已经在磁盘上
    // 这个方法主要用于触发 SQLite 读取，让数据进入 OS 缓存
    this.ensureInitialized()

    this.db.prepare(`
      SELECT content_hash, embedding_json FROM embedding_cache
      WHERE model = ?
      ORDER BY access_count DESC, last_access_at DESC
      LIMIT ?
    `).all(model, limit)
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.initialized = false
    }
  }
}

/**
 * 带缓存的 EmbeddingService 包装器
 * 在调用原始 EmbeddingService 前后自动处理缓存读写
 */
export class CachedEmbeddingService implements EmbeddingService {
  private originalService: EmbeddingService
  private cacheManager: EmbeddingCacheManager
  private model: string

  /**
   * @param originalService - 原始 EmbeddingService
   * @param cacheManager - 缓存管理器
   * @param model - 模型标识（用于缓存隔离，模型变更时缓存自动失效）
   */
  constructor(
    originalService: EmbeddingService,
    cacheManager: EmbeddingCacheManager,
    model: string = 'default'
  ) {
    this.originalService = originalService
    this.cacheManager = cacheManager
    this.model = model
  }

  async embed(text: string): Promise<number[]> {
    // 1. 查缓存
    const cached = this.cacheManager.get(text, this.model)
    if (cached) {
      return cached
    }

    // 2. 缓存未命中，调用原始服务
    const embedding = await this.originalService.embed(text)

    // 3. 写入缓存
    this.cacheManager.set(text, this.model, embedding)

    return embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // 1. 批量查缓存
    const cachedResults = this.cacheManager.getBatch(texts, this.model)

    const results: number[][] = new Array(texts.length)
    const missIndices: number[] = []
    const missTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      if (cachedResults[i]) {
        results[i] = cachedResults[i]!
      } else {
        missIndices.push(i)
        missTexts.push(texts[i])
      }
    }

    // 2. 对未命中的文本调用原始服务
    if (missTexts.length > 0) {
      const missEmbeddings = await this.originalService.embedBatch(missTexts)

      // 写入缓存
      this.cacheManager.setBatch(missTexts, this.model, missEmbeddings)

      // 填充结果
      for (let i = 0; i < missIndices.length; i++) {
        results[missIndices[i]] = missEmbeddings[i]
      }
    }

    return results
  }

  getDimensions(): number {
    return this.originalService.getDimensions()
  }
}

/**
 * 便捷工厂函数：创建带缓存的 EmbeddingService
 */
export function createCachedEmbeddingService(
  originalService: EmbeddingService,
  cacheManager?: EmbeddingCacheManager,
  model?: string
): CachedEmbeddingService {
  const cache = cacheManager || new EmbeddingCacheManager()
  return new CachedEmbeddingService(originalService, cache, model)
}
