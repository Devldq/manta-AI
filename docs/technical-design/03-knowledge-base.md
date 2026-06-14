# 知识库技术方案 / Knowledge Base Technical Design

## 1. 概述

知识库是Manta平台的**核心差异化能力**，基于RAG（检索增强生成）技术实现。本文档详细描述知识库模块的技术实现方案，包括RAG Provider架构、文档处理流水线、向量存储、检索算法等。

### 1.1 设计目标
- **可插拔架构**：支持多种RAG Provider，便于扩展
- **本地优先**：v1阶段默认使用SQLiteVec，零配置
- **渐进增强**：从简单向量检索到混合检索
- **用户友好**：可视化配置，实时预览效果

### 1.2 技术栈
- **文档解析**：pdf-parse, mammoth, xlsx
- **文本分块**：自研分块算法
- **向量化**：OpenAI Embedding API / 本地模型
- **向量存储**：sqlite-vec (P0), ChromaDB (P1), Milvus (P2)
- **检索算法**：向量相似度、BM25、混合检索

---

## 2. RAG Provider 架构

### 2.1 Provider 接口设计

```typescript
// 核心接口定义
interface IRagProvider {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string
  
  // 生命周期管理
  initialize(config: RagProviderConfig): Promise<void>
  destroy(): Promise<void>
  
  // 文档操作
  indexDocument(doc: ProcessedDocument): Promise<IndexResult>
  indexBatch(docs: ProcessedDocument[], onProgress?: ProgressCallback): Promise<IndexResult[]>
  deleteDocument(docId: string): Promise<void>
  clearAll(): Promise<void>
  
  // 检索功能
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>
  
  // 元数据查询
  getDocument(docId: string): Promise<DocumentInfo | null>
  listDocuments(filter?: DocumentFilter): Promise<DocumentInfo[]>
  healthCheck(): Promise<HealthStatus>
  getStats(): Promise<RagStats>
}

// 配置接口
interface RagProviderConfig {
  providerId: string
  embeddingModel?: string
  dimensions?: number
  apiKey?: string
  baseUrl?: string
  // Provider特定配置
  [key: string]: any
}

// 文档处理结果
interface ProcessedDocument {
  id: string
  content: string
  metadata: DocumentMetadata
  chunks: Chunk[]
}

interface Chunk {
  id: string
  content: string
  metadata: ChunkMetadata
  embedding?: number[]
}
```

### 2.2 Provider 注册表

```typescript
// Provider管理器
class RagProviderRegistry {
  private providers: Map<string, IRagProviderFactory> = new Map()
  
  register(factory: IRagProviderFactory): void {
    this.providers.set(factory.id, factory)
  }
  
  async create(providerId: string, config: RagProviderConfig): Promise<IRagProvider> {
    const factory = this.providers.get(providerId)
    if (!factory) {
      throw new Error(`Provider ${providerId} not found`)
    }
    
    const provider = factory.create()
    await provider.initialize(config)
    return provider
  }
  
  list(): ProviderInfo[] {
    return Array.from(this.providers.values()).map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      version: f.version
    }))
  }
}
```

---

## 3. 文档处理流水线

### 3.1 处理流程

```typescript
class DocumentProcessor {
  async process(file: File, options: ProcessingOptions): Promise<ProcessedDocument> {
    // 1. 格式检测
    const format = this.detectFormat(file)
    
    // 2. 文本提取
    const rawText = await this.extractText(file, format)
    
    // 3. 文本预处理
    const processedText = this.preprocess(rawText)
    
    // 4. 分块处理
    const chunks = await this.chunk(processedText, options.chunkingStrategy)
    
    // 5. 生成文档ID
    const docId = generateDocId(file.name, file.size)
    
    return {
      id: docId,
      content: processedText,
      metadata: {
        filename: file.name,
        format,
        size: file.size,
        chunkCount: chunks.length,
        processedAt: new Date()
      },
      chunks
    }
  }
  
  private async extractText(file: File, format: DocumentFormat): Promise<string> {
    switch (format) {
      case 'pdf':
        return this.extractFromPDF(file)
      case 'docx':
        return this.extractFromDOCX(file)
      case 'md':
      case 'txt':
        return this.readTextFile(file)
      case 'xlsx':
      case 'csv':
        return this.extractFromSpreadsheet(file)
      default:
        throw new UnsupportedFormatError(format)
    }
  }
}
```

### 3.2 分块策略

```typescript
// 分块策略接口
interface ChunkingStrategy {
  chunk(text: string, options: ChunkingOptions): Chunk[]
}

// 固定大小分块
class FixedSizeChunking implements ChunkingStrategy {
  chunk(text: string, options: FixedSizeOptions): Chunk[] {
    const { chunkSize = 500, overlap = 50 } = options
    const chunks: Chunk[] = []
    
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
      const content = text.slice(i, i + chunkSize)
      chunks.push({
        id: generateChunkId(),
        content,
        metadata: {
          startIndex: i,
          endIndex: i + content.length,
          strategy: 'fixed-size'
        }
      })
    }
    
    return chunks
  }
}

// 语义分块
class SemanticChunking implements ChunkingStrategy {
  chunk(text: string, options: SemanticOptions): Chunk[] {
    // 基于段落、章节、标点符号进行分块
    const paragraphs = text.split(/\n\s*\n/)
    const chunks: Chunk[] = []
    
    let currentChunk = ''
    for (const para of paragraphs) {
      if (currentChunk.length + para.length > options.maxChunkSize) {
        if (currentChunk) {
          chunks.push(this.createChunk(currentChunk))
          currentChunk = ''
        }
      }
      currentChunk += para + '\n\n'
    }
    
    if (currentChunk) {
      chunks.push(this.createChunk(currentChunk))
    }
    
    return chunks
  }
}

// 递归字符分割
class RecursiveChunking implements ChunkingStrategy {
  private separators = ['\n\n', '\n', '。', '！', '？', '.', '!', '?']
  
  chunk(text: string, options: RecursiveOptions): Chunk[] {
    return this.recursiveSplit(text, options.maxChunkSize, 0)
  }
  
  private recursiveSplit(text: string, maxSize: number, depth: number): Chunk[] {
    if (text.length <= maxSize) {
      return [this.createChunk(text)]
    }
    
    const separator = this.separators[depth % this.separators.length]
    const parts = text.split(separator)
    
    const chunks: Chunk[] = []
    let currentChunk = ''
    
    for (const part of parts) {
      if (currentChunk.length + part.length > maxSize) {
        if (currentChunk) {
          chunks.push(...this.recursiveSplit(currentChunk, maxSize, depth + 1))
          currentChunk = ''
        }
        if (part.length > maxSize) {
          chunks.push(...this.recursiveSplit(part, maxSize, depth + 1))
        } else {
          currentChunk = part
        }
      } else {
        currentChunk += (currentChunk ? separator : '') + part
      }
    }
    
    if (currentChunk) {
      chunks.push(...this.recursiveSplit(currentChunk, maxSize, depth + 1))
    }
    
    return chunks
  }
}
```

---

## 4. 向量化与存储

### 4.1 Embedding 服务

```typescript
class EmbeddingService {
  private model: string
  private dimensions: number
  private apiKey: string
  private baseUrl: string
  
  constructor(config: EmbeddingConfig) {
    this.model = config.model || 'text-embedding-3-small'
    this.dimensions = config.dimensions || 1536
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1'
  }
  
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions
      })
    })
    
    const data = await response.json()
    return data.data[0].embedding
  }
  
  async embedBatch(texts: string[], batchSize = 100): Promise<number[][]> {
    const results: number[][] = []
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          dimensions: this.dimensions
        })
      })
      
      const data = await response.json()
      results.push(...data.data.map((d: any) => d.embedding))
    }
    
    return results
  }
}
```

### 4.2 SQLiteVec Provider 实现

```typescript
class SQLiteVecProvider implements IRagProvider {
  readonly id = 'sqlite-vec'
  readonly name = 'SQLiteVec'
  readonly description = '本地向量数据库，基于sqlite-vec扩展'
  readonly version = '1.0.0'
  
  private db: Database
  private embeddingService: EmbeddingService
  
  async initialize(config: RagProviderConfig): Promise<void> {
    // 初始化SQLite数据库
    this.db = await Database.open(config.dbPath || '~/.manta-data/vectors.db')
    
    // 加载sqlite-vec扩展
    await this.db.loadExtension('vec0')
    
    // 创建向量表
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding FLOAT[{this.dimensions}]
      )
    `)
    
    // 创建索引
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_doc_id ON vectors(doc_id)
    `)
  }
  
  async indexDocument(doc: ProcessedDocument): Promise<IndexResult> {
    const startTime = Date.now()
    
    // 为每个分块生成embedding
    const embeddings = await this.embeddingService.embedBatch(
      doc.chunks.map(c => c.content)
    )
    
    // 批量插入
    const stmt = await this.db.prepare(`
      INSERT OR REPLACE INTO vectors (id, doc_id, content, metadata, embedding)
      VALUES (?, ?, ?, ?, ?)
    `)
    
    for (let i = 0; i < doc.chunks.length; i++) {
      const chunk = doc.chunks[i]
      await stmt.run(
        chunk.id,
        doc.id,
        chunk.content,
        JSON.stringify(chunk.metadata),
        JSON.stringify(embeddings[i])
      )
    }
    
    await stmt.finalize()
    
    return {
      success: true,
      docId: doc.id,
      chunkCount: doc.chunks.length,
      processingTime: Date.now() - startTime
    }
  }
  
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const { topK = 5, threshold = 0.7 } = options || {}
    
    // 生成查询向量
    const queryEmbedding = await this.embeddingService.embed(query)
    
    // 向量相似度搜索
    const results = await this.db.all(`
      SELECT 
        id,
        doc_id,
        content,
        metadata,
        1 - vec_distance_cosine(embedding, ?) as similarity
      FROM vectors
      WHERE 1 - vec_distance_cosine(embedding, ?) > ?
      ORDER BY similarity DESC
      LIMIT ?
    `, [queryEmbedding, queryEmbedding, threshold, topK])
    
    return results.map(row => ({
      id: row.id,
      docId: row.doc_id,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      score: row.similarity
    }))
  }
  
  async hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]> {
    const { topK = 5, vectorWeight = 0.7, bm25Weight = 0.3 } = options || {}
    
    // 向量搜索
    const vectorResults = await this.search(query, { topK: topK * 2 })
    
    // BM25搜索
    const bm25Results = await this.bm25Search(query, { topK: topK * 2 })
    
    // 结果融合（RRF算法）
    const merged = this.reciprocalRankFusion(
      vectorResults,
      bm25Results,
      vectorWeight,
      bm25Weight
    )
    
    return merged.slice(0, topK)
  }
}
```

---

## 5. API 实现

### 5.1 API 路由

```typescript
// app/api/rag/knowledge-bases/route.ts
export async function GET() {
  const knowledgeBases = await knowledgeBaseService.list()
  return NextResponse.json(knowledgeBases)
}

export async function POST(request: Request) {
  const body = await request.json()
  const knowledgeBase = await knowledgeBaseService.create(body)
  return NextResponse.json(knowledgeBase, { status: 201 })
}

// app/api/rag/knowledge-bases/[id]/route.ts
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const knowledgeBase = await knowledgeBaseService.getById(params.id)
  if (!knowledgeBase) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(knowledgeBase)
}

// app/api/rag/knowledge-bases/[id]/documents/route.ts
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const formData = await request.formData()
  const file = formData.get('file') as File
  
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }
  
  // 处理上传
  const result = await documentService.upload(params.id, file)
  return NextResponse.json(result)
}

// app/api/rag/knowledge-bases/[id]/search/route.ts
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { query, options } = await request.json()
  const results = await searchService.search(params.id, query, options)
  return NextResponse.json(results)
}
```

### 5.2 服务层实现

```typescript
class KnowledgeBaseService {
  private db: Database
  private providerRegistry: RagProviderRegistry
  
  async create(data: CreateKnowledgeBaseDTO): Promise<KnowledgeBase> {
    const id = generateId()
    const provider = await this.providerRegistry.create(data.providerId, {
      providerId: data.providerId,
      embeddingModel: data.embeddingModel,
      dimensions: data.dimensions,
      apiKey: data.apiKey
    })
    
    await this.db.run(`
      INSERT INTO knowledge_bases (id, name, description, provider_id, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, data.name, data.description, data.providerId, JSON.stringify(data.config), new Date()])
    
    return { id, ...data, provider }
  }
  
  async uploadDocument(kbId: string, file: File): Promise<UploadResult> {
    const kb = await this.getById(kbId)
    if (!kb) throw new NotFoundError('Knowledge base')
    
    // 1. 处理文档
    const processed = await this.documentProcessor.process(file, {
      chunkingStrategy: kb.config.chunkingStrategy || 'semantic'
    })
    
    // 2. 索引到向量库
    const indexResult = await kb.provider.indexDocument(processed)
    
    // 3. 保存文档元数据
    await this.db.run(`
      INSERT INTO documents (id, kb_id, filename, format, size, chunk_count, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [processed.id, kbId, file.name, file.type, file.size, processed.chunks.length, 'indexed', new Date()])
    
    return {
      docId: processed.id,
      chunkCount: processed.chunks.length,
      processingTime: indexResult.processingTime
    }
  }
}
```

---

## 6. 前端组件设计

### 6.1 知识库列表组件

```tsx
// components/rag/KnowledgeBaseList.tsx
export function KnowledgeBaseList() {
  const { data: knowledgeBases, isLoading } = useSWR('/api/rag/knowledge-bases', fetcher)
  
  if (isLoading) return <LoadingSkeleton />
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {knowledgeBases?.map(kb => (
        <KnowledgeBaseCard key={kb.id} knowledgeBase={kb} />
      ))}
      <CreateKnowledgeBaseCard />
    </div>
  )
}

// components/rag/KnowledgeBaseCard.tsx
export function KnowledgeBaseCard({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          {knowledgeBase.name}
        </CardTitle>
        <CardDescription>{knowledgeBase.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>文档数</span>
            <span>{knowledgeBase.stats.documentCount}</span>
          </div>
          <div className="flex justify-between">
            <span>分块数</span>
            <span>{knowledgeBase.stats.chunkCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Provider</span>
            <span>{knowledgeBase.provider.name}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/rag/${knowledgeBase.id}`}>管理</Link>
        </Button>
        <Button variant="ghost" size="sm">
          <Trash2 className="w-4 h-4" />
        </Button>
      </CardFooter>
    </Card>
  )
}
```

### 6.2 检索测试组件

```tsx
// components/rag/SearchTest.tsx
export function SearchTest({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [options, setOptions] = useState<SearchOptions>({
    topK: 5,
    threshold: 0.7,
    mode: 'vector'
  })
  
  const handleSearch = async () => {
    if (!query.trim()) return
    
    setIsSearching(true)
    try {
      const response = await fetch(`/api/rag/knowledge-bases/${knowledgeBaseId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, options })
      })
      const data = await response.json()
      setResults(data)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setIsSearching(false)
    }
  }
  
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Input
          placeholder="输入测试查询..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={isSearching}>
          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          搜索
        </Button>
      </div>
      
      <div className="flex gap-4">
        <Select value={options.mode} onValueChange={(v) => setOptions({ ...options, mode: v as any })}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vector">向量检索</SelectItem>
            <SelectItem value="hybrid">混合检索</SelectItem>
          </SelectContent>
        </Select>
        
        <div className="flex items-center gap-2">
          <span className="text-sm">TopK:</span>
          <Input
            type="number"
            value={options.topK}
            onChange={(e) => setOptions({ ...options, topK: parseInt(e.target.value) })}
            className="w-20"
            min={1}
            max={20}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm">阈值:</span>
          <Input
            type="number"
            value={options.threshold}
            onChange={(e) => setOptions({ ...options, threshold: parseFloat(e.target.value) })}
            className="w-24"
            min={0}
            max={1}
            step={0.1}
          />
        </div>
      </div>
      
      <div className="space-y-4">
        {results.map((result, index) => (
          <Card key={result.id}>
            <CardContent className="pt-4">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground">#{index + 1}</span>
                  <span className="text-sm">{result.metadata.filename}</span>
                </div>
                <Badge variant="secondary">
                  相似度: {(result.score * 100).toFixed(1)}%
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-3">
                {result.content}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
```

---

## 7. 错误处理

### 7.1 错误类型定义

```typescript
// lib/errors/rag-errors.ts
export class UnsupportedFormatError extends Error {
  constructor(format: string) {
    super(`Unsupported document format: ${format}`)
    this.name = 'UnsupportedFormatError'
  }
}

export class FileTooLargeError extends Error {
  constructor(maxSize: number) {
    super(`File size exceeds maximum limit of ${maxSize}MB`)
    this.name = 'FileTooLargeError'
  }
}

export class EmptyContentError extends Error {
  constructor() {
    super('Failed to extract valid text content from document')
    this.name = 'EmptyContentError'
  }
}

export class EmbeddingTimeoutError extends Error {
  constructor() {
    super('Embedding API request timed out')
    this.name = 'EmbeddingTimeoutError'
  }
}

export class ProviderNotAvailableError extends Error {
  constructor(providerId: string) {
    super(`RAG provider ${providerId} is not available`)
    this.name = 'ProviderNotAvailableError'
  }
}
```

### 7.2 错误处理中间件

```typescript
// lib/middleware/error-handler.ts
export function ragErrorHandler(error: Error): NextResponse {
  console.error('RAG Error:', error)
  
  if (error instanceof UnsupportedFormatError) {
    return NextResponse.json({
      error: 'Unsupported format',
      message: error.message,
      supportedFormats: ['pdf', 'docx', 'md', 'txt', 'xlsx', 'csv']
    }, { status: 400 })
  }
  
  if (error instanceof FileTooLargeError) {
    return NextResponse.json({
      error: 'File too large',
      message: error.message,
      maxSize: '50MB'
    }, { status: 413 })
  }
  
  if (error instanceof EmptyContentError) {
    return NextResponse.json({
      error: 'Empty content',
      message: error.message
    }, { status: 422 })
  }
  
  if (error instanceof EmbeddingTimeoutError) {
    return NextResponse.json({
      error: 'Embedding timeout',
      message: 'Embedding API request timed out. Please try again.'
    }, { status: 504 })
  }
  
  return NextResponse.json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  }, { status: 500 })
}
```

---

## 8. 性能优化

### 8.1 批量处理优化

```typescript
class BatchProcessor {
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: BatchOptions = {}
  ): Promise<R[]> {
    const { batchSize = 100, concurrency = 5, onProgress } = options
    const results: R[] = []
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchResults = await Promise.all(
        batch.map(item => processor(item))
      )
      results.push(...batchResults)
      
      if (onProgress) {
        onProgress(Math.min(i + batchSize, items.length), items.length)
      }
    }
    
    return results
  }
}
```

### 8.2 缓存策略

```typescript
class EmbeddingCache {
  private cache: Map<string, number[]> = new Map()
  private maxSize: number
  
  constructor(maxSize = 10000) {
    this.maxSize = maxSize
  }
  
  async get(text: string): Promise<number[] | null> {
    const key = this.generateKey(text)
    return this.cache.get(key) || null
  }
  
  async set(text: string, embedding: number[]): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      // LRU淘汰
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    const key = this.generateKey(text)
    this.cache.set(key, embedding)
  }
  
  private generateKey(text: string): string {
    // 使用hash生成缓存key
    return hashText(text)
  }
}
```

---

## 9. 监控与日志

### 9.1 性能监控

```typescript
class RAGMetrics {
  private metrics: Map<string, number[]> = new Map()
  
  recordOperation(operation: string, duration: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, [])
    }
    this.metrics.get(operation)!.push(duration)
  }
  
  getStats(operation: string): MetricStats {
    const durations = this.metrics.get(operation) || []
    if (durations.length === 0) {
      return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0 }
    }
    
    const sorted = [...durations].sort((a, b) => a - b)
    return {
      count: durations.length,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    }
  }
}
```

### 9.2 日志记录

```typescript
class RAGLogger {
  private logger: Logger
  
  constructor() {
    this.logger = createLogger({
      level: 'info',
      format: format.combine(
        format.timestamp(),
        format.json()
      ),
      transports: [
        new transports.File({ filename: 'logs/rag.log' }),
        new transports.Console()
      ]
    })
  }
  
  logDocumentProcessed(docId: string, chunkCount: number, duration: number): void {
    this.logger.info('Document processed', {
      docId,
      chunkCount,
      duration,
      operation: 'document_processing'
    })
  }
  
  logSearch(query: string, resultCount: number, duration: number): void {
    this.logger.info('Search completed', {
      query: query.substring(0, 100),
      resultCount,
      duration,
      operation: 'search'
    })
  }
  
  logError(error: Error, context: any): void {
    this.logger.error('RAG error', {
      error: error.message,
      stack: error.stack,
      context,
      operation: 'error'
    })
  }
}
```

---

## 10. 实现计划

### 10.1 第一阶段：基础功能（2周）
1. 实现SQLiteVecProvider基础版本
2. 支持PDF、DOCX、TXT格式解析
3. 实现固定大小和语义分块策略
4. 实现基础向量检索
5. 完成知识库CRUD API

### 10.2 第二阶段：增强功能（2周）
1. 实现混合检索（向量 + BM25）
2. 支持更多文档格式（XLSX、CSV）
3. 实现检索测试界面
4. 添加性能监控和日志
5. 优化批量处理性能

### 10.3 第三阶段：扩展与优化（1周）
1. 实现ChromaDB Provider
2. 添加Embedding缓存
3. 优化错误处理和重试机制
4. 完善文档和示例

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于PRD 03创建 |

---

> 上一篇：[02-workspace.md](./02-workspace.md)
> 下一篇：[04-workflow.md](./04-workflow.md)