import Database from 'better-sqlite3'
import * as path from 'path'
import { ensureDir } from './fs-utils'
import type {
  RAGProvider,
  KnowledgeBaseConfig,
  DocumentMetadata,
  DocumentChunk,
  SearchOptions,
  RetrievalResult,
  KnowledgeBaseStats,
} from './types'

// ─── 数据库行类型 ────────────────────────────────────────────

interface DocRow {
  id: string
  kb_id: string
  name: string
  mime_type: string
  size: number
  status: string
  chunk_count: number
  uploaded_at: string
  processed_at: string | null
  error: string | null
  source_path: string | null
  source_sha256: string | null
}

interface ChunkRow {
  id: string
  doc_id: string
  kb_id: string
  content: string
  embedding_json: string
  metadata_json: string
  start_index: number | null
  end_index: number | null
}

// ─── SQLiteVecProvider ───────────────────────────────────────

export class SQLiteVecProvider implements RAGProvider {
  readonly id = 'sqlite-vec'
  readonly name = 'SQLite-vec Provider'

  private db!: Database.Database
  private initialized = false
  private dbPath: string

  /**
   * 获取底层数据库实例（供 EmbeddingCacheManager 复用）
   */
  getDatabase(): Database.Database {
    return this.db
  }

  constructor(storageDir: string) {
    if (!storageDir) throw new Error('RAG storage directory is required')
    this.dbPath = path.join(storageDir, 'vectors.db')
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      ensureDir(path.dirname(this.dbPath))

      this.db = new Database(this.dbPath)

      // 启用 WAL 模式提升并发读取性能
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = -64000') // 64MB cache

      // 创建文档表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          kb_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          chunk_count INTEGER NOT NULL DEFAULT 0,
          uploaded_at TEXT NOT NULL,
          processed_at TEXT,
          error TEXT,
          source_path TEXT,
          source_sha256 TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      const documentColumns = this.db.pragma('table_info(documents)') as Array<{ name: string }>
      if (!documentColumns.some((column) => column.name === 'source_path')) this.db.exec('ALTER TABLE documents ADD COLUMN source_path TEXT')
      if (!documentColumns.some((column) => column.name === 'source_sha256')) this.db.exec('ALTER TABLE documents ADD COLUMN source_sha256 TEXT')

      // 创建分块表（embedding 以 JSON 文本存储）
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
          id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          kb_id TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          start_index INTEGER,
          end_index INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        )
      `)

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chunks_kb_id ON chunks(kb_id);
        CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);
        CREATE INDEX IF NOT EXISTS idx_documents_kb_id ON documents(kb_id);
      `)

      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize SQLiteVecProvider:', error)
      throw error
    }
  }

  async createKnowledgeBase(id: string, name: string, _config?: KnowledgeBaseConfig): Promise<void> {
    await this.ensureInitialized()
    // 知识库元数据由 knowledge-base-store.ts 管理
    console.log(`[SQLiteVec] 知识库已注册: ${id} - ${name}`)
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    await this.ensureInitialized()
    const delChunks = this.db.prepare('DELETE FROM chunks WHERE kb_id = ?')
    const delDocs = this.db.prepare('DELETE FROM documents WHERE kb_id = ?')

    const tx = this.db.transaction(() => {
      delChunks.run(id)
      delDocs.run(id)
    })
    tx()

    console.log(`[SQLiteVec] 知识库已删除: ${id}`)
  }

  async addDocument(
    knowledgeBaseId: string,
    document: DocumentMetadata,
    chunks: DocumentChunk[]
  ): Promise<void> {
    await this.ensureInitialized()

    const now = new Date().toISOString()

    const insertDoc = this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, kb_id, name, mime_type, size, status, chunk_count, uploaded_at, processed_at, error, source_path, source_sha256)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, doc_id, kb_id, content, embedding_json, metadata_json, start_index, end_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const tx = this.db.transaction(() => {
      // 先删除旧数据（重复上传时）
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(document.id)
      this.db.prepare('DELETE FROM documents WHERE id = ?').run(document.id)

      // 插入文档元数据
      insertDoc.run(
        document.id,
        knowledgeBaseId,
        document.name,
        document.type,
        document.size,
        'ready',
        chunks.length,
        document.uploadedAt,
        now,
        null,
        document.sourcePath ?? null,
        document.sourceSha256 ?? null
      )

      // 批量插入 chunks
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          document.id,
          knowledgeBaseId,
          chunk.content,
          JSON.stringify(chunk.embedding || []),
          JSON.stringify(chunk.metadata || {}),
          chunk.startIndex ?? null,
          chunk.endIndex ?? null
        )
      }
    })

    tx()
  }

  async removeDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    await this.ensureInitialized()

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chunks WHERE doc_id = ? AND kb_id = ?').run(documentId, knowledgeBaseId)
      this.db.prepare('DELETE FROM documents WHERE id = ? AND kb_id = ?').run(documentId, knowledgeBaseId)
    })

    tx()
  }

  /**
   * 插入一条 status='processing' 的文档记录（处理前写入，刷新页面后可见）
   * 如果该 docId 已存在则替换（重复上传同一文件）
   */
  async insertPendingDocument(
    knowledgeBaseId: string,
    document: DocumentMetadata
  ): Promise<void> {
    await this.ensureInitialized()

    this.db.prepare(`
      INSERT OR REPLACE INTO documents (id, kb_id, name, mime_type, size, status, chunk_count, uploaded_at, processed_at, error, source_path, source_sha256)
      VALUES (?, ?, ?, ?, ?, 'processing', 0, ?, NULL, NULL, ?, ?)
    `).run(
      document.id,
      knowledgeBaseId,
      document.name,
      document.type,
      document.size,
      document.uploadedAt,
      document.sourcePath ?? null,
      document.sourceSha256 ?? null
    )
  }

  /**
   * 更新文档状态（处理完成后或失败时调用）
   */
  async updateDocumentStatus(
    documentId: string,
    status: DocumentMetadata['status'],
    error?: string
  ): Promise<void> {
    await this.ensureInitialized()

    const processedAt = status === 'ready' || status === 'error' ? new Date().toISOString() : null

    this.db.prepare(`
      UPDATE documents SET status = ?, error = ?, processed_at = COALESCE(?, processed_at)
      WHERE id = ?
    `).run(status, error ?? null, processedAt, documentId)
  }

  /**
   * 清理所有 stuck 在 processing 状态的文档（后端重启时调用）
   * 将它们标记为 error，避免永远卡在 processing
   * 返回被清理的文档列表（kbId → docId → docName）
   */
  async cleanupStaleDocuments(): Promise<
    { kbId: string; docId: string; docName: string }[]
  > {
    await this.ensureInitialized()

    const staleDocs = this.db.prepare(`
      SELECT id, kb_id, name FROM documents WHERE status = 'processing'
    `).all() as { id: string; kb_id: string; name: string }[]

    if (staleDocs.length === 0) return []

    const now = new Date().toISOString()
    const updateStmt = this.db.prepare(`
      UPDATE documents SET status = 'error', error = ?, processed_at = ?
      WHERE id = ?
    `)

    const tx = this.db.transaction(() => {
      for (const doc of staleDocs) {
        updateStmt.run(
          '处理被中断（服务器重启），请重新上传此文件',
          now,
          doc.id
        )
      }
    })
    tx()

    return staleDocs.map((d) => ({
      kbId: d.kb_id,
      docId: d.id,
      docName: d.name,
    }))
  }

  async search(
    knowledgeBaseId: string,
    query: string,
    options?: SearchOptions
  ): Promise<RetrievalResult[]> {
    await this.ensureInitialized()

    const topK = options?.topK || 5
    const threshold = options?.threshold || 0.0

    // 获取知识库中所有 chunks
    const rows = this.db.prepare(`
      SELECT c.*, d.name as doc_name
      FROM chunks c
      JOIN documents d ON c.doc_id = d.id
      WHERE c.kb_id = ?
    `).all(knowledgeBaseId) as (ChunkRow & { doc_name: string })[]

    if (rows.length === 0) {
      return []
    }

    // search() 方法没有 query embedding，使用关键词匹配评分
    // 如果需要向量检索，使用 vectorSearch() 方法（需要外部提供 query embedding）

    const results: RetrievalResult[] = rows.map((row) => {
      let score: number

      try {
        // 关键词匹配评分
        score = keywordMatchScore(query, row.content)
      } catch {
        score = 0
      }

      return {
        chunk: {
          id: row.id,
          documentId: row.doc_id,
          content: row.content,
          metadata: safeJsonParse(row.metadata_json, { docName: row.doc_name }),
          startIndex: row.start_index ?? undefined,
          endIndex: row.end_index ?? undefined,
        },
        score,
        metadata: {
          documentName: row.doc_name,
          documentId: row.doc_id,
        },
      }
    })

    // 过滤低于阈值的，按分数降序排列
    return results
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  /**
   * 使用预先生成的 query embedding 进行向量检索
   */
  async vectorSearch(
    knowledgeBaseId: string,
    queryEmbedding: number[],
    options?: SearchOptions
  ): Promise<RetrievalResult[]> {
    await this.ensureInitialized()

    const topK = options?.topK || 5
    const threshold = options?.threshold || 0.0

    const rows = this.db.prepare(`
      SELECT c.*, d.name as doc_name
      FROM chunks c
      JOIN documents d ON c.doc_id = d.id
      WHERE c.kb_id = ?
    `).all(knowledgeBaseId) as (ChunkRow & { doc_name: string })[]

    const results: RetrievalResult[] = []

    for (const row of rows) {
      try {
        const chunkEmbedding = JSON.parse(row.embedding_json) as number[]
        if (chunkEmbedding.length === 0) continue

        const score = cosineSimilarity(queryEmbedding, chunkEmbedding)

        if (score >= threshold) {
          results.push({
            chunk: {
              id: row.id,
              documentId: row.doc_id,
              content: row.content,
              metadata: safeJsonParse(row.metadata_json, { docName: row.doc_name }),
              embedding: chunkEmbedding,
              startIndex: row.start_index ?? undefined,
              endIndex: row.end_index ?? undefined,
            },
            score,
            metadata: { documentName: row.doc_name, documentId: row.doc_id },
          })
        }
      } catch {
        // skip malformed embeddings
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  async getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats> {
    await this.ensureInitialized()

    const docStats = this.db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize, COALESCE(SUM(chunk_count), 0) as totalChunks
      FROM documents WHERE kb_id = ?
    `).get(knowledgeBaseId) as { count: number; totalSize: number; totalChunks: number } | undefined

    // 获取实际 chunks 数量和最后更新时间
    const chunkCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM chunks WHERE kb_id = ?
    `).get(knowledgeBaseId) as { count: number }

    const lastDoc = this.db.prepare(`
      SELECT processed_at FROM documents WHERE kb_id = ? ORDER BY processed_at DESC LIMIT 1
    `).get(knowledgeBaseId) as { processed_at: string | null } | undefined

    return {
      documentCount: docStats?.count || 0,
      chunkCount: chunkCount?.count || docStats?.totalChunks || 0,
      totalSize: docStats?.totalSize || 0,
      lastUpdated: lastDoc?.processed_at || undefined,
    }
  }

  /**
   * 获取知识库中的文档列表
   */
  async getDocuments(knowledgeBaseId: string): Promise<DocumentMetadata[]> {
    await this.ensureInitialized()

    const rows = this.db.prepare(`
      SELECT * FROM documents WHERE kb_id = ? ORDER BY uploaded_at DESC
    `).all(knowledgeBaseId) as DocRow[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.mime_type,
      size: row.size,
      uploadedAt: row.uploaded_at,
      processedAt: row.processed_at || undefined,
      chunkCount: row.chunk_count,
      status: row.status as DocumentMetadata['status'],
      error: row.error || undefined,
      sourcePath: row.source_path || undefined,
      sourceSha256: row.source_sha256 || undefined,
    }))
  }

  /**
   * 获取文档详情
   */
  async getDocument(documentId: string): Promise<DocumentMetadata | null> {
    await this.ensureInitialized()

    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as DocRow | undefined

    if (!row) return null

    return {
      id: row.id,
      name: row.name,
      type: row.mime_type,
      size: row.size,
      uploadedAt: row.uploaded_at,
      processedAt: row.processed_at || undefined,
      chunkCount: row.chunk_count,
      status: row.status as DocumentMetadata['status'],
      error: row.error || undefined,
      sourcePath: row.source_path || undefined,
      sourceSha256: row.source_sha256 || undefined,
    }
  }

  async hasSourceSha256(sha256: string): Promise<boolean> {
    await this.ensureInitialized()
    return Boolean(this.db.prepare('SELECT 1 FROM documents WHERE source_sha256 = ? LIMIT 1').get(sha256))
  }

  /**
   * 获取文档的所有 chunks（用于预览）
   */
  async getDocumentChunks(documentId: string, limit = 50): Promise<(DocumentChunk & { embedding?: number[] })[]> {
    await this.ensureInitialized()

    const rows = this.db.prepare(`
      SELECT * FROM chunks WHERE doc_id = ? ORDER BY start_index ASC LIMIT ?
    `).all(documentId, limit) as ChunkRow[]

    return rows.map((row) => ({
      id: row.id,
      documentId: row.doc_id,
      content: row.content,
      metadata: safeJsonParse(row.metadata_json, {}),
      embedding: safeJsonParse(row.embedding_json, undefined) || undefined,
      startIndex: row.start_index ?? undefined,
      endIndex: row.end_index ?? undefined,
    }))
  }

  /**
   * 关闭数据库连接
   */
  async checkpoint(): Promise<void> {
    if (this.initialized) this.db.pragma('wal_checkpoint(TRUNCATE)')
  }

  async integrityCheck(): Promise<{ ok: boolean; error?: string }> {
    await this.ensureInitialized()
    const rows = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const error = rows.map((row) => row.integrity_check).find((value) => value !== 'ok')
    return error ? { ok: false, error } : { ok: true }
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.initialized = false
    }
  }

  async reopen(storageDir: string): Promise<void> {
    if (!storageDir) throw new Error('RAG storage directory is required')
    await this.close()
    this.dbPath = path.join(storageDir, 'vectors.db')
    await this.initialize()
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
}

// ─── 工具函数 ────────────────────────────────────────────────

/** 余弦相似度计算 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 关键词匹配分数 (简单 BM25 风格) */
function keywordMatchScore(query: string, content: string): number {
  const queryTerms = query
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）\(\)\[\]【】]+/)
    .filter((t) => t.length > 0)

  if (queryTerms.length === 0) return 0

  const contentLower = content.toLowerCase()
  let score = 0

  for (const term of queryTerms) {
    // 精确匹配加分
    const regex = new RegExp(escapeRegExp(term), 'gi')
    const matches = contentLower.match(regex)
    if (matches) {
      score += matches.length * (1 + Math.log(1 + term.length / content.length))
    }
  }

  // 归一化到 [0, 1]
  const maxPossibleScore = queryTerms.length * 5
  return Math.min(score / maxPossibleScore, 1.0)
}

/** 安全的 JSON 解析 */
function safeJsonParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return defaultValue
  }
}

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── 工厂函数 ────────────────────────────────────────────────

let providerInstance: SQLiteVecProvider | null = null

export function createSQLiteVecProvider(storageDir: string): SQLiteVecProvider {
  return new SQLiteVecProvider(storageDir)
}

export function configureSQLiteVecProvider(storageDir: string): SQLiteVecProvider {
  if (providerInstance) throw new Error('SQLiteVecProvider is already configured; reset it before reconfiguring')
  providerInstance = new SQLiteVecProvider(storageDir)
  return providerInstance
}

/** 获取 SQLiteVecProvider 实例（带具体类型，用于调用扩展方法） */
export function getSQLiteVecProvider(): SQLiteVecProvider {
  if (!providerInstance) throw new Error('SQLiteVecProvider has not been configured with a storage directory')
  return providerInstance
}

export async function resetSQLiteVecProvider(): Promise<void> {
  const current = providerInstance
  await current?.close()
  if (providerInstance === current) providerInstance = null
}
