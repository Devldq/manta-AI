# 记忆系统技术方案 / Memory System Technical Design

## 1. 概述

记忆系统为智能体应用提供**跨对话的知识记忆能力**，让Agent能够"记住"用户偏好、历史交互和领域知识。本文档详细描述记忆系统模块的技术实现方案。

### 1.1 设计目标
- **多类型记忆**：支持短期、长期、工作记忆
- **自动提取**：从对话中自动识别和提取记忆
- **智能检索**：基于向量和关键词的混合检索
- **生命周期管理**：自动清理过期记忆

### 1.2 记忆类型
- **短期记忆**：会话级，当前会话的上下文摘要
- **长期记忆**：持久化，跨对话的知识片段、用户偏好
- **工作记忆**：任务级，当前任务的临时数据

---

## 2. 记忆数据结构

### 2.1 核心接口

```typescript
// 记忆条目
interface MemoryEntry {
  id: string
  appId: string                   // 所属应用
  type: 'short-term' | 'long-term' | 'working'
  category: string                // 分类：preference, knowledge, behavior, context
  content: string                 // 记忆内容
  embedding?: number[]            // 向量化（用于检索）
  metadata: MemoryMetadata
  createdAt: string
  updatedAt: string
  expiresAt?: string              // 过期时间（短期记忆）
}

interface MemoryMetadata {
  source: 'conversation' | 'manual' | 'auto'
  conversationId?: string         // 来源会话 ID
  importance: number              // 重要性 (0-1)
  accessCount: number             // 访问次数
  lastAccessedAt?: string         // 最后访问时间
  tags?: string[]                 // 标签
  relatedMemories?: string[]      // 关联记忆ID
}

// 记忆检索结果
interface MemorySearchResult {
  entry: MemoryEntry
  score: number                   // 相关性分数
  context: string                 // 匹配的上下文片段
  matchType: 'vector' | 'keyword' | 'hybrid'
}

// 记忆检索选项
interface MemorySearchOptions {
  query: string                   // 检索查询
  type?: 'short-term' | 'long-term' | 'working'
  category?: string               // 分类过滤
  topK?: number                   // 返回数量
  minImportance?: number          // 最小重要性
  timeRange?: {
    start?: string
    end?: string
  }
  includeExpired?: boolean        // 是否包含过期记忆
}
```

### 2.2 记忆分类

```typescript
// 记忆分类定义
type MemoryCategory = 
  | 'preference'    // 用户偏好
  | 'knowledge'     // 领域知识
  | 'behavior'      // 行为模式
  | 'context'       // 上下文信息
  | 'fact'          // 重要事实
  | 'emotion'       // 情感状态

// 分类配置
interface CategoryConfig {
  category: MemoryCategory
  name: string
  description: string
  defaultImportance: number
  autoExtract: boolean
  retentionDays?: number
}

const CATEGORY_CONFIGS: CategoryConfig[] = [
  {
    category: 'preference',
    name: '用户偏好',
    description: '用户的喜好和厌恶',
    defaultImportance: 0.8,
    autoExtract: true,
    retentionDays: 365
  },
  {
    category: 'knowledge',
    name: '领域知识',
    description: '用户分享的专业知识',
    defaultImportance: 0.7,
    autoExtract: true,
    retentionDays: 180
  },
  {
    category: 'behavior',
    name: '行为模式',
    description: '用户的重复行为模式',
    defaultImportance: 0.6,
    autoExtract: true,
    retentionDays: 90
  },
  {
    category: 'context',
    name: '上下文信息',
    description: '当前对话的上下文',
    defaultImportance: 0.5,
    autoExtract: true,
    retentionDays: 30
  },
  {
    category: 'fact',
    name: '重要事实',
    description: '关键信息和事实',
    defaultImportance: 0.9,
    autoExtract: true,
    retentionDays: 365
  },
  {
    category: 'emotion',
    name: '情感状态',
    description: '用户的情感和情绪',
    defaultImportance: 0.4,
    autoExtract: true,
    retentionDays: 7
  }
]
```

---

## 3. 记忆存储

### 3.1 存储接口

```typescript
interface IMemoryStore {
  // 存储记忆
  save(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>
  
  // 检索记忆
  search(options: MemorySearchOptions): Promise<MemorySearchResult[]>
  
  // 获取记忆
  get(id: string): Promise<MemoryEntry | null>
  
  // 更新记忆
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>
  
  // 删除记忆
  delete(id: string): Promise<void>
  
  // 批量删除
  deleteBatch(ids: string[]): Promise<void>
  
  // 清理过期记忆
  cleanup(): Promise<number>
  
  // 获取统计信息
  getStats(appId: string): Promise<MemoryStats>
}
```

### 3.2 SQLite 存储实现

```typescript
class SQLiteMemoryStore implements IMemoryStore {
  private db: Database
  private embeddingService: EmbeddingService
  
  async save(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const id = generateId()
    const now = new Date().toISOString()
    
    // 生成embedding
    const embedding = await this.embeddingService.embed(entry.content)
    
    const memoryEntry: MemoryEntry = {
      ...entry,
      id,
      embedding,
      createdAt: now,
      updatedAt: now
    }
    
    await this.db.run(`
      INSERT INTO memories (id, app_id, type, category, content, embedding, metadata, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      memoryEntry.id,
      memoryEntry.appId,
      memoryEntry.type,
      memoryEntry.category,
      memoryEntry.content,
      JSON.stringify(memoryEntry.embedding),
      JSON.stringify(memoryEntry.metadata),
      memoryEntry.createdAt,
      memoryEntry.updatedAt,
      memoryEntry.expiresAt
    ])
    
    return memoryEntry
  }
  
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const { query, type, category, topK = 5, minImportance = 0, timeRange, includeExpired = false } = options
    
    // 生成查询embedding
    const queryEmbedding = await this.embeddingService.embed(query)
    
    // 构建SQL查询
    let sql = `
      SELECT 
        id, app_id, type, category, content, embedding, metadata, created_at, updated_at, expires_at,
        1 - vec_distance_cosine(embedding, ?) as vector_score
      FROM memories
      WHERE app_id = ?
    `
    const params: any[] = [queryEmbedding, options.appId]
    
    // 添加过滤条件
    if (type) {
      sql += ` AND type = ?`
      params.push(type)
    }
    
    if (category) {
      sql += ` AND category = ?`
      params.push(category)
    }
    
    if (minImportance > 0) {
      sql += ` AND json_extract(metadata, '$.importance') >= ?`
      params.push(minImportance)
    }
    
    if (timeRange) {
      if (timeRange.start) {
        sql += ` AND created_at >= ?`
        params.push(timeRange.start)
      }
      if (timeRange.end) {
        sql += ` AND created_at <= ?`
        params.push(timeRange.end)
      }
    }
    
    if (!includeExpired) {
      sql += ` AND (expires_at IS NULL OR expires_at > ?)`
      params.push(new Date().toISOString())
    }
    
    // 添加排序和限制
    sql += ` ORDER BY vector_score DESC LIMIT ?`
    params.push(topK)
    
    const results = await this.db.all(sql, params)
    
    return results.map(row => ({
      entry: this.rowToEntry(row),
      score: row.vector_score,
      context: this.extractContext(row.content, query),
      matchType: 'vector' as const
    }))
  }
  
  async cleanup(): Promise<number> {
    const now = new Date().toISOString()
    
    const result = await this.db.run(`
      DELETE FROM memories 
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `, [now])
    
    return result.changes
  }
  
  async getStats(appId: string): Promise<MemoryStats> {
    const stats = await this.db.get(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN type = 'short-term' THEN 1 ELSE 0 END) as short_term,
        SUM(CASE WHEN type = 'long-term' THEN 1 ELSE 0 END) as long_term,
        SUM(CASE WHEN type = 'working' THEN 1 ELSE 0 END) as working,
        AVG(json_extract(metadata, '$.importance')) as avg_importance,
        AVG(json_extract(metadata, '$.accessCount')) as avg_access_count
      FROM memories
      WHERE app_id = ?
    `, [appId])
    
    return {
      total: stats.total,
      byType: {
        shortTerm: stats.short_term,
        longTerm: stats.long_term,
        working: stats.working
      },
      avgImportance: stats.avg_importance,
      avgAccessCount: stats.avg_access_count
    }
  }
}
```

---

## 4. 记忆提取

### 4.1 自动提取器

```typescript
class MemoryExtractor {
  private llm: LLMService
  private memoryStore: IMemoryStore
  
  async extractFromConversation(
    appId: string,
    conversationId: string,
    messages: Message[]
  ): Promise<MemoryEntry[]> {
    const memories: MemoryEntry[] = []
    
    // 分析对话内容
    const analysis = await this.analyzeConversation(messages)
    
    // 提取用户偏好
    if (analysis.preferences.length > 0) {
      for (const pref of analysis.preferences) {
        const memory = await this.memoryStore.save({
          appId,
          type: 'long-term',
          category: 'preference',
          content: pref,
          metadata: {
            source: 'auto',
            conversationId,
            importance: 0.8,
            accessCount: 0
          }
        })
        memories.push(memory)
      }
    }
    
    // 提取领域知识
    if (analysis.knowledge.length > 0) {
      for (const knowledge of analysis.knowledge) {
        const memory = await this.memoryStore.save({
          appId,
          type: 'long-term',
          category: 'knowledge',
          content: knowledge,
          metadata: {
            source: 'auto',
            conversationId,
            importance: 0.7,
            accessCount: 0
          }
        })
        memories.push(memory)
      }
    }
    
    // 提取重要事实
    if (analysis.facts.length > 0) {
      for (const fact of analysis.facts) {
        const memory = await this.memoryStore.save({
          appId,
          type: 'long-term',
          category: 'fact',
          content: fact,
          metadata: {
            source: 'auto',
            conversationId,
            importance: 0.9,
            accessCount: 0
          }
        })
        memories.push(memory)
      }
    }
    
    // 生成会话摘要（短期记忆）
    const summary = await this.generateSummary(messages)
    if (summary) {
      await this.memoryStore.save({
        appId,
        type: 'short-term',
        category: 'context',
        content: summary,
        metadata: {
          source: 'auto',
          conversationId,
          importance: 0.5,
          accessCount: 0
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24小时后过期
      })
    }
    
    return memories
  }
  
  private async analyzeConversation(messages: Message[]): Promise<ConversationAnalysis> {
    const prompt = `
请分析以下对话，提取：
1. 用户偏好（喜好、厌恶、习惯）
2. 领域知识（专业知识、技术信息）
3. 重要事实（关键信息、日期、数字）

对话内容：
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

请以JSON格式返回：
{
  "preferences": ["偏好1", "偏好2"],
  "knowledge": ["知识1", "知识2"],
  "facts": ["事实1", "事实2"]
}
`
    
    const response = await this.llm.chat(prompt)
    return JSON.parse(response)
  }
  
  private async generateSummary(messages: Message[]): Promise<string | null> {
    if (messages.length < 3) return null
    
    const prompt = `
请为以下对话生成一个简洁的摘要（不超过100字）：

${messages.map(m => `${m.role}: ${m.content}`).join('\n')}

摘要：
`
    
    return this.llm.chat(prompt)
  }
}
```

### 4.2 手动创建

```typescript
class ManualMemoryCreator {
  private memoryStore: IMemoryStore
  private embeddingService: EmbeddingService
  
  async create(appId: string, data: CreateMemoryDTO): Promise<MemoryEntry> {
    // 验证输入
    this.validateInput(data)
    
    // 创建记忆
    const memory = await this.memoryStore.save({
      appId,
      type: data.type || 'long-term',
      category: data.category,
      content: data.content,
      metadata: {
        source: 'manual',
        importance: data.importance || 0.7,
        accessCount: 0,
        tags: data.tags
      }
    })
    
    return memory
  }
  
  private validateInput(data: CreateMemoryDTO): void {
    if (!data.content || data.content.trim().length === 0) {
      throw new Error('记忆内容不能为空')
    }
    
    if (data.content.length > 1000) {
      throw new Error('记忆内容不能超过1000个字符')
    }
    
    if (!data.category) {
      throw new Error('必须选择记忆分类')
    }
  }
}
```

---

## 5. 记忆检索

### 5.1 混合检索器

```typescript
class HybridMemorySearcher {
  private vectorSearcher: VectorSearcher
  private keywordSearcher: KeywordSearcher
  private reranker: Reranker
  
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    // 并行执行向量检索和关键词检索
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(options),
      this.keywordSearch(options)
    ])
    
    // 结果融合
    const mergedResults = this.mergeResults(vectorResults, keywordResults)
    
    // 重排序
    const rerankedResults = await this.reranker.rerank(options.query, mergedResults)
    
    // 返回TopK
    return rerankedResults.slice(0, options.topK || 5)
  }
  
  private async vectorSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    return this.vectorSearcher.search(options)
  }
  
  private async keywordSearch(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    return this.keywordSearcher.search(options)
  }
  
  private mergeResults(
    vectorResults: MemorySearchResult[],
    keywordResults: MemorySearchResult[]
  ): MemorySearchResult[] {
    const merged = new Map<string, MemorySearchResult>()
    
    // 添加向量检索结果
    for (const result of vectorResults) {
      merged.set(result.entry.id, {
        ...result,
        score: result.score * 0.7, // 向量权重
        matchType: 'vector'
      })
    }
    
    // 融合关键词检索结果
    for (const result of keywordResults) {
      const existing = merged.get(result.entry.id)
      if (existing) {
        // 合并分数
        existing.score = existing.score + result.score * 0.3
        existing.matchType = 'hybrid'
      } else {
        merged.set(result.entry.id, {
          ...result,
          score: result.score * 0.3, // 关键词权重
          matchType: 'keyword'
        })
      }
    }
    
    return Array.from(merged.values())
  }
}
```

### 5.2 关键词检索器

```typescript
class KeywordSearcher {
  private db: Database
  
  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const { query, appId, type, category, topK = 5 } = options
    
    // 提取关键词
    const keywords = this.extractKeywords(query)
    
    // 构建SQL查询
    let sql = `
      SELECT 
        id, app_id, type, category, content, metadata, created_at, updated_at, expires_at,
        (
          ${keywords.map((_, i) => `CASE WHEN content LIKE ? THEN 1 ELSE 0 END`).join(' + ')}
        ) as keyword_score
      FROM memories
      WHERE app_id = ?
    `
    
    const params: any[] = [
      ...keywords.map(k => `%${k}%`),
      appId
    ]
    
    if (type) {
      sql += ` AND type = ?`
      params.push(type)
    }
    
    if (category) {
      sql += ` AND category = ?`
      params.push(category)
    }
    
    sql += ` HAVING keyword_score > 0`
    sql += ` ORDER BY keyword_score DESC, json_extract(metadata, '$.importance') DESC`
    sql += ` LIMIT ?`
    params.push(topK)
    
    const results = await this.db.all(sql, params)
    
    return results.map(row => ({
      entry: this.rowToEntry(row),
      score: row.keyword_score / keywords.length,
      context: this.extractContext(row.content, query),
      matchType: 'keyword' as const
    }))
  }
  
  private extractKeywords(query: string): string[] {
    // 简单的关键词提取
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2)
  }
}
```

---

## 6. API 实现

### 6.1 API 路由

```typescript
// app/api/apps/[appId]/memory/route.ts
export async function GET(request: Request, { params }: { params: { appId: string } }) {
  const memories = await memoryService.list(params.appId)
  return NextResponse.json(memories)
}

export async function POST(request: Request, { params }: { params: { appId: string } }) {
  const body = await request.json()
  const memory = await memoryService.create(params.appId, body)
  return NextResponse.json(memory, { status: 201 })
}

// app/api/apps/[appId]/memory/[id]/route.ts
export async function GET(request: Request, { params }: { params: { appId: string; id: string } }) {
  const memory = await memoryService.get(params.appId, params.id)
  if (!memory) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(memory)
}

export async function PUT(request: Request, { params }: { params: { appId: string; id: string } }) {
  const body = await request.json()
  const memory = await memoryService.update(params.appId, params.id, body)
  return NextResponse.json(memory)
}

export async function DELETE(request: Request, { params }: { params: { appId: string; id: string } }) {
  await memoryService.delete(params.appId, params.id)
  return NextResponse.json({ success: true })
}

// app/api/apps/[appId]/memory/search/route.ts
export async function POST(request: Request, { params }: { params: { appId: string } }) {
  const body = await request.json()
  const results = await memoryService.search(params.appId, body)
  return NextResponse.json(results)
}

// app/api/apps/[appId]/memory/cleanup/route.ts
export async function POST(request: Request, { params }: { params: { appId: string } }) {
  const count = await memoryService.cleanup(params.appId)
  return NextResponse.json({ cleaned: count })
}
```

### 6.2 服务层实现

```typescript
class MemoryService {
  private memoryStore: IMemoryStore
  private extractor: MemoryExtractor
  
  async create(appId: string, data: CreateMemoryDTO): Promise<MemoryEntry> {
    return this.memoryStore.save({
      appId,
      type: data.type || 'long-term',
      category: data.category,
      content: data.content,
      metadata: {
        source: 'manual',
        importance: data.importance || 0.7,
        accessCount: 0,
        tags: data.tags
      }
    })
  }
  
  async search(appId: string, options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const results = await this.memoryStore.search({
      ...options,
      appId
    })
    
    // 更新访问计数
    for (const result of results) {
      await this.memoryStore.update(result.entry.id, {
        metadata: {
          ...result.entry.metadata,
          accessCount: result.entry.metadata.accessCount + 1,
          lastAccessedAt: new Date().toISOString()
        }
      })
    }
    
    return results
  }
  
  async extractFromConversation(appId: string, conversationId: string, messages: Message[]): Promise<MemoryEntry[]> {
    return this.extractor.extractFromConversation(appId, conversationId, messages)
  }
  
  async cleanup(appId: string): Promise<number> {
    return this.memoryStore.cleanup()
  }
  
  async getStats(appId: string): Promise<MemoryStats> {
    return this.memoryStore.getStats(appId)
  }
}
```

---

## 7. 前端组件设计

### 7.1 记忆管理组件

```tsx
// components/memory/MemoryManager.tsx
export function MemoryManager({ appId }: { appId: string }) {
  const { data: memories, isLoading, mutate } = useSWR(`/api/apps/${appId}/memory`, fetcher)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  if (isLoading) return <LoadingSkeleton />
  
  const filteredMemories = memories?.filter(memory => {
    if (categoryFilter !== 'all' && memory.category !== categoryFilter) return false
    if (searchQuery && !memory.content.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">记忆管理</h2>
        <Button onClick={() => setShowCreateDialog(true)}>
          添加记忆
        </Button>
      </div>
      
      <div className="flex gap-4">
        <Input
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            <SelectItem value="preference">用户偏好</SelectItem>
            <SelectItem value="knowledge">领域知识</SelectItem>
            <SelectItem value="behavior">行为模式</SelectItem>
            <SelectItem value="context">上下文信息</SelectItem>
            <SelectItem value="fact">重要事实</SelectItem>
            <SelectItem value="emotion">情感状态</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-4">
        {filteredMemories?.map(memory => (
          <MemoryCard key={memory.id} memory={memory} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  )
}

// components/memory/MemoryCard.tsx
export function MemoryCard({ memory, onDelete }: { memory: MemoryEntry; onDelete: (id: string) => void }) {
  const categoryIcons: Record<string, React.ReactNode> = {
    preference: <Lightbulb className="w-4 h-4" />,
    knowledge: <BookOpen className="w-4 h-4" />,
    behavior: <Activity className="w-4 h-4" />,
    context: <FileText className="w-4 h-4" />,
    fact: <CheckCircle className="w-4 h-4" />,
    emotion: <Heart className="w-4 h-4" />
  }
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {categoryIcons[memory.category]}
            <span className="font-medium">{getCategoryName(memory.category)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              重要性: {memory.metadata.importance.toFixed(1)}
            </Badge>
            <Badge variant="secondary">
              {memory.type}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-2">
          {memory.content}
        </p>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>来源: {memory.metadata.source}</span>
          <span>访问次数: {memory.metadata.accessCount}</span>
          <span>创建时间: {formatDateTime(memory.createdAt)}</span>
        </div>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button variant="ghost" size="sm">
          编辑
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(memory.id)}>
          删除
        </Button>
      </CardFooter>
    </Card>
  )
}
```

### 7.2 记忆检索组件

```tsx
// components/memory/MemorySearch.tsx
export function MemorySearch({ appId }: { appId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemorySearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  
  const handleSearch = async () => {
    if (!query.trim()) return
    
    setIsSearching(true)
    try {
      const response = await fetch(`/api/apps/${appId}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: 10 })
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
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="搜索记忆..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={isSearching}>
          {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          搜索
        </Button>
      </div>
      
      <div className="space-y-2">
        {results.map((result, index) => (
          <div key={result.entry.id} className="p-3 border rounded-lg">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium">#{index + 1}</span>
              <Badge variant="outline">
                相关性: {(result.score * 100).toFixed(1)}%
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {result.entry.content}
            </p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <span>分类: {getCategoryName(result.entry.category)}</span>
              <span>匹配类型: {result.matchType}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## 8. 错误处理

### 8.1 错误类型

```typescript
export class MemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Memory not found: ${id}`)
    this.name = 'MemoryNotFoundError'
  }
}

export class InvalidMemoryError extends Error {
  constructor(message: string) {
    super(`Invalid memory: ${message}`)
    this.name = 'InvalidMemoryError'
  }
}

export class MemoryStorageError extends Error {
  constructor(message: string) {
    super(`Memory storage error: ${message}`)
    this.name = 'MemoryStorageError'
  }
}

export class MemorySearchError extends Error {
  constructor(message: string) {
    super(`Memory search error: ${message}`)
    this.name = 'MemorySearchError'
  }
}
```

### 8.2 错误处理

```typescript
export function memoryErrorHandler(error: Error): NextResponse {
  console.error('Memory Error:', error)
  
  if (error instanceof MemoryNotFoundError) {
    return NextResponse.json({
      error: 'Not found',
      message: error.message
    }, { status: 404 })
  }
  
  if (error instanceof InvalidMemoryError) {
    return NextResponse.json({
      error: 'Invalid memory',
      message: error.message
    }, { status: 400 })
  }
  
  if (error instanceof MemoryStorageError) {
    return NextResponse.json({
      error: 'Storage error',
      message: error.message
    }, { status: 500 })
  }
  
  return NextResponse.json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  }, { status: 500 })
}
```

---

## 9. 性能优化

### 9.1 缓存优化

```typescript
class MemoryCache {
  private cache: Map<string, MemoryEntry[]> = new Map()
  private maxSize: number = 1000
  
  async getOrLoad(appId: string, key: string, loader: () => Promise<MemoryEntry[]>): Promise<MemoryEntry[]> {
    const cacheKey = `${appId}:${key}`
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }
    
    const memories = await loader()
    
    // LRU淘汰
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(cacheKey, memories)
    
    return memories
  }
  
  invalidate(appId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${appId}:`)) {
        this.cache.delete(key)
      }
    }
  }
}
```

### 9.2 批量操作

```typescript
class BatchMemoryProcessor {
  async processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<void>,
    batchSize: number = 100
  ): Promise<void> {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      await Promise.all(batch.map(item => processor(item)))
    }
  }
}
```

---

## 10. 实现计划

### 10.1 第一阶段：基础功能（2周）
1. 实现记忆数据结构和存储
2. 实现记忆CRUD API
3. 实现基础检索功能
4. 完成记忆管理界面

### 10.2 第二阶段：智能提取（2周）
1. 实现自动记忆提取器
2. 实现混合检索算法
3. 实现记忆分类和标签
4. 添加记忆统计功能

### 10.3 第三阶段：优化与扩展（1周）
1. 实现缓存优化
2. 添加批量操作
3. 优化错误处理
4. 完善文档和示例

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于PRD 07创建 |

---

> 上一篇：[06-evaluation.md](./06-evaluation.md)
> 下一篇：[08-data-model.md](./08-data-model.md)