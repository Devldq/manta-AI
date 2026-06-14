# Manta-AI 技术方案 / Technical Design

---

## 1. 概述

本文档基于 PRD 00-10 系列文档，提供 Manta 平台的**核心技术实现方案**。技术方案遵循以下原则：

- **渐进增强**：基于现有代码库，不破坏已有功能
- **模块化设计**：高内聚低耦合，便于独立开发和测试
- **类型安全**：TypeScript 严格模式，编译时错误检查
- **本地优先**：v1 阶段所有数据存储在本地

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     客户端 (Next.js App Router)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  React Server Components (RSC)                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │   │
│  │  │ 页面组件  │ │ 业务组件  │ │ 基础组件  │             │   │
│  │  └──────────┘ └──────────┘ └──────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  客户端状态管理 (Zustand)                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │   │
│  │  │ AppStore │ │ RAGStore │ │ WorkflowStore│           │   │
│  │  └──────────┘ └──────────┘ └──────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                     服务端 (Next.js API Routes)               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API 路由层                                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │   │
│  │  │/api/apps │ │/api/rag  │ │/api/workflow│           │   │
│  │  └──────────┘ └──────────┘ └──────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  业务逻辑层 (Services)                                │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │   │
│  │  │AppService│ │RAGService│ │WorkflowService│         │   │
│  │  └──────────┘ └──────────┘ └──────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  数据访问层 (Repositories)                            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐             │   │
│  │  │FileStore │ │SQLiteVec │ │MemoryStore│             │   │
│  │  └──────────┘ └──────────┘ └──────────┘             │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                     存储层                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ 文件系统  │ │ SQLite-vec│ │ 内存缓存  │ │ 向量索引  │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
src/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # 仪表板布局
│   │   ├── apps/                 # 应用管理页面
│   │   ├── rag/                  # 知识库页面
│   │   ├── workflow/             # 工作流页面
│   │   └── evaluation/           # 评估中心页面
│   ├── api/                      # API 路由
│   │   ├── apps/                 # 应用管理 API
│   │   ├── rag/                  # 知识库 API
│   │   ├── workflow/             # 工作流 API
│   │   ├── eval/                 # 评估 API
│   │   └── chat/                 # 对话 API (已有)
│   └── layout.tsx                # 根布局
├── components/                   # React 组件
│   ├── ui/                       # 基础 UI 组件
│   ├── layout/                   # 布局组件
│   ├── apps/                     # 应用相关组件
│   ├── rag/                      # 知识库相关组件
│   ├── workflow/                 # 工作流相关组件
│   └── workspace/                # 工作空间相关组件
├── core/                         # 核心模块
│   ├── types.ts                  # 类型定义 (已有)
│   ├── constants.ts              # 常量定义
│   ├── errors.ts                 # 错误类型
│   └── utils.ts                  # 工具函数
├── services/                     # 业务逻辑层
│   ├── app.service.ts            # 应用管理服务
│   ├── rag.service.ts            # 知识库服务
│   ├── workflow.service.ts       # 工作流服务
│   ├── memory.service.ts         # 记忆系统服务
│   ├── eval.service.ts           # 评估服务
│   └── agent.service.ts          # Agent 服务 (已有)
├── repositories/                 # 数据访问层
│   ├── file.repository.ts        # 文件系统存储
│   ├── sqlite-vec.repository.ts  # SQLite-vec 存储
│   ├── memory.repository.ts      # 记忆存储
│   └── cache.repository.ts       # 缓存存储
├── engines/                      # 引擎层
│   ├── rag/                      # RAG 引擎
│   │   ├── providers/            # Provider 实现
│   │   ├── parsers/              # 文档解析器
│   │   ├── chunkers/             # 分块策略
│   │   └── embedders/            # Embedding 服务
│   ├── workflow/                 # 工作流引擎
│   │   ├── executor.ts           # 执行器
│   │   ├── scheduler.ts          # 调度器
│   │   └── handlers/             # 步骤处理器
│   ├── memory/                   # 记忆引擎
│   │   ├── extractor.ts          # 记忆提取器
│   │   ├── retriever.ts          # 记忆检索器
│   │   └── compressor.ts         # 记忆压缩器
│   └── eval/                     # 评估引擎
│       ├── rag.eval.ts           # RAG 评估
│       ├── agent.eval.ts         # Agent 评估
│       └── judge.ts              # LLM Judge
├── stores/                       # Zustand 状态管理
│   ├── app.store.ts              # 应用状态
│   ├── rag.store.ts              # 知识库状态
│   ├── workflow.store.ts         # 工作流状态
│   ├── workspace.store.ts        # 工作空间状态
│   └── memory.store.ts           # 记忆状态
└── lib/                          # 第三方库封装
    ├── llm.ts                    # LLM 调用封装
    ├── embedding.ts              # Embedding 调用封装
    ├── vector-db.ts              # 向量数据库封装
    └── file-utils.ts             # 文件工具函数
```

## 3. 核心模块设计

### 3.1 应用管理模块

#### 3.1.1 数据流

```
用户操作 → React 组件 → Zustand Store → API Route → AppService → FileRepository → 文件系统
```

#### 3.1.2 核心接口

```typescript
// services/app.service.ts
interface IAppService {
  // CRUD
  create(input: CreateAppInput): Promise<AppConfig>
  getById(id: string): Promise<AppConfig | null>
  list(filter?: AppFilter): Promise<AppConfig[]>
  update(id: string, patch: UpdateAppInput): Promise<AppConfig>
  delete(id: string): Promise<void>
  clone(id: string): Promise<AppConfig>
  
  // 状态管理
  publish(id: string): Promise<AppConfig>
  unpublish(id: string): Promise<AppConfig>
  archive(id: string): Promise<AppConfig>
  restore(id: string): Promise<AppConfig>
}

// repositories/file.repository.ts
interface IFileRepository<T> {
  get(id: string): Promise<T | null>
  list(filter?: Record<string, unknown>): Promise<T[]>
  create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>
  update(id: string, patch: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
}
```

### 3.2 知识库模块

#### 3.2.1 RAG Provider 架构

```typescript
// engines/rag/providers/base.provider.ts
abstract class BaseRagProvider implements IRagProvider {
  abstract readonly id: string
  abstract readonly name: string
  
  // 生命周期
  abstract initialize(config: RagProviderConfig): Promise<void>
  abstract destroy(): Promise<void>
  
  // 文档操作
  abstract indexDocument(doc: ProcessedDocument): Promise<IndexResult>
  abstract deleteDocument(docId: string): Promise<void>
  abstract clearAll(): Promise<void>
  
  // 检索
  abstract search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  abstract hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>
}
```

#### 3.2.2 文档处理流水线

```typescript
// engines/rag/pipeline.ts
class DocumentProcessingPipeline {
  private parser: IDocumentParser
  private chunker: IChunker
  private embedder: IEmbedder
  private provider: IRagProvider
  
  async process(file: File): Promise<ProcessingResult> {
    // 1. 解析文档
    const parsed = await this.parser.parse(file)
    
    // 2. 分块
    const chunks = await this.chunker.chunk(parsed.content)
    
    // 3. 向量化
    const embeddings = await this.embedder.embedBatch(chunks)
    
    // 4. 索引
    const results = await this.provider.indexBatch(
      chunks.map((chunk, i) => ({
        ...chunk,
        embedding: embeddings[i]
      }))
    )
    
    return {
      documentId: parsed.id,
      chunkCount: chunks.length,
      indexedCount: results.filter(r => r.success).length
    }
  }
}
```

### 3.3 工作流模块

#### 3.3.1 执行引擎

```typescript
// engines/workflow/executor.ts
class WorkflowExecutor {
  private handlers: Map<WorkflowStepType, IStepHandler>
  private eventEmitter: EventEmitter
  
  async execute(workflow: WorkflowDef, context: WorkflowContext): Promise<WorkflowExecution> {
    // 创建执行实例
    const execution: WorkflowExecution = {
      taskId: context.taskId,
      workflowId: workflow.id,
      status: 'running',
      steps: [],
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    
    // 执行步骤
    await this.executeSteps(workflow.steps, execution, context)
    
    return execution
  }
}
```

### 3.4 记忆系统模块

#### 3.4.1 记忆提取器

```typescript
// engines/memory/extractor.ts
class MemoryExtractor {
  private llm: ILLM
  
  async extractFromConversation(
    messages: ConversationMessage[]
  ): Promise<ExtractedMemory[]> {
    // 构建提取提示
    const prompt = this.buildExtractionPrompt(messages)
    
    // 调用 LLM 提取记忆
    const response = await this.llm.chat(prompt)
    
    // 解析结果
    const memories = this.parseMemories(response)
    
    return memories.map(memory => ({
      ...memory,
      metadata: {
        source: 'auto',
        importance: this.calculateImportance(memory),
        accessCount: 0
      }
    }))
  }
}
```

### 3.5 评估系统模块

#### 3.5.1 RAGAs 评估

```typescript
// engines/eval/rag.eval.ts
class RagEvaluator {
  private llm: ILLM
  private ragService: IRagService
  
  async evaluate(
    dataset: RagEvalDataset,
    config: EvalConfig
  ): Promise<RagEvalResult> {
    const results: RagEvalEntryResult[] = []
    
    for (const entry of dataset.entries) {
      // 1. 执行检索
      const searchResults = await this.ragService.search(entry.question)
      
      // 2. 生成答案
      const answer = await this.ragService.generateAnswer(
        entry.question,
        searchResults
      )
      
      // 3. 计算各维度分数
      const dimensions = await this.evaluateDimensions(entry, answer, searchResults)
      
      results.push({
        entryId: entry.id,
        question: entry.question,
        answer,
        contexts: searchResults.map(r => r.content),
        dimensions
      })
    }
    
    // 4. 汇总分数
    const summary = this.summarizeResults(results)
    
    return {
      datasetId: dataset.id,
      results,
      summary,
      completedAt: new Date().toISOString()
    }
  }
}
```

## 4. API 设计实现

### 4.1 API 路由结构

```typescript
// app/api/apps/route.ts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filter: AppFilter = {
      status: searchParams.get('status') as AppStatus,
      search: searchParams.get('search'),
      sort: searchParams.get('sort') as SortField
    }
    
    const apps = await appService.list(filter)
    
    return NextResponse.json({
      success: true,
      data: apps
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const input: CreateAppInput = await request.json()
    
    // 验证输入
    const validated = validateCreateAppInput(input)
    
    const app = await appService.create(validated)
    
    return NextResponse.json({
      success: true,
      data: app
    }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
```

### 4.2 错误处理

```typescript
// core/errors.ts
class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// 预定义错误
export const Errors = {
  NOT_FOUND: (resource: string, id: string) =>
    new AppError('NOT_FOUND', `${resource} not found: ${id}`, 404),
  
  VALIDATION_ERROR: (field: string, message: string) =>
    new AppError('VALIDATION_ERROR', `Validation failed: ${field} - ${message}`, 400),
  
  CONFLICT: (resource: string, id: string) =>
    new AppError('CONFLICT', `${resource} already exists: ${id}`, 409),
  
  INTERNAL_ERROR: (message: string) =>
    new AppError('INTERNAL_ERROR', message, 500)
}
```

## 5. 状态管理

### 5.1 Zustand Store 设计

```typescript
// stores/app.store.ts
interface AppState {
  // 数据
  apps: AppConfig[]
  currentApp: AppConfig | null
  
  // 状态
  loading: boolean
  error: string | null
  
  // 操作
  fetchApps: (filter?: AppFilter) => Promise<void>
  fetchApp: (id: string) => Promise<void>
  createApp: (input: CreateAppInput) => Promise<AppConfig>
  updateApp: (id: string, patch: UpdateAppInput) => Promise<void>
  deleteApp: (id: string) => Promise<void>
  publishApp: (id: string) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  apps: [],
  currentApp: null,
  loading: false,
  error: null,
  
  fetchApps: async (filter) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(`/api/apps?${new URLSearchParams(filter)}`)
      const data = await response.json()
      
      if (data.success) {
        set({ apps: data.data, loading: false })
      } else {
        set({ error: data.error.message, loading: false })
      }
    } catch (error) {
      set({ error: 'Failed to fetch apps', loading: false })
    }
  },
  
  // ... 其他操作
}))
```

## 6. 性能优化策略

### 6.1 前端优化

1. **懒加载组件**：使用 `React.lazy` 和 `Suspense` 按需加载页面组件
2. **虚拟滚动**：使用 `@tanstack/react-virtual` 处理长列表
3. **防抖搜索**：搜索输入使用防抖，减少 API 调用
4. **代码分割**：按路由分割代码，减少初始加载体积

### 6.2 后端优化

1. **缓存策略**：使用内存缓存，设置合理的 TTL
2. **数据库索引**：为常用查询字段创建索引
3. **批量操作**：分批处理大量数据，避免单次操作过大
4. **异步处理**：耗时操作使用异步队列

## 7. 测试策略

### 7.1 单元测试

- **工具函数**：测试所有工具函数
- **服务层**：测试业务逻辑
- **组件**：测试 React 组件

### 7.2 集成测试

- **API 端点**：测试所有 API 端点
- **数据库操作**：测试数据读写
- **端到端流程**：测试核心业务流程

### 7.3 性能测试

- **加载时间**：页面首屏加载 < 1s
- **API 响应**：API 响应时间 < 500ms
- **内存使用**：监控内存泄漏

## 8. 部署方案

### 8.1 开发环境

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行测试
pnpm test

# 代码检查
pnpm lint
```

### 8.2 生产环境

```bash
# 构建
pnpm build

# 启动
pnpm start

# 环境变量
NEXT_PUBLIC_API_URL=https://api.example.com
DATABASE_URL=sqlite:./data.db
```

### 8.3 Docker 部署

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install

COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
```

## 9. 安全考虑

### 9.1 数据安全

- **敏感数据加密**：API Key 等敏感数据加密存储
- **文件权限**：数据目录权限设置为 700
- **输入验证**：所有用户输入进行验证和清理

### 9.2 API 安全

- **CORS 配置**：限制允许的来源
- **速率限制**：防止 API 滥用
- **错误处理**：不泄露敏感信息

## 10. 监控和日志

### 10.1 日志系统

```typescript
// lib/logger.ts
class Logger {
  private static instance: Logger
  
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }
  
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...meta
    }))
  }
  
  error(message: string, error?: Error): void {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error?.message,
      stack: error?.stack,
      timestamp: new Date().toISOString()
    }))
  }
}
```

### 10.2 性能监控

```typescript
// lib/monitor.ts
class PerformanceMonitor {
  private static metrics = new Map<string, number[]>()
  
  static startTimer(name: string): () => void {
    const start = performance.now()
    
    return () => {
      const duration = performance.now() - start
      const metrics = PerformanceMonitor.metrics.get(name) || []
      metrics.push(duration)
      PerformanceMonitor.metrics.set(name, metrics)
    }
  }
  
  static getMetrics(name: string): { avg: number; p95: number; p99: number } {
    const metrics = PerformanceMonitor.metrics.get(name) || []
    if (metrics.length === 0) {
      return { avg: 0, p95: 0, p99: 0 }
    }
    
    const sorted = [...metrics].sort((a, b) => a - b)
    const avg = metrics.reduce((a, b) => a + b, 0) / metrics.length
    const p95 = sorted[Math.floor(sorted.length * 0.95)]
    const p99 = sorted[Math.floor(sorted.length * 0.99)]
    
    return { avg, p95, p99 }
  }
}
```

## 11. 未来扩展

### 11.1 计划功能

- **多租户支持**：支持多用户协作
- **云同步**：数据云端同步
- **应用市场**：应用模板和分享
- **移动端**：移动 App 开发

### 11.2 技术演进

- **微服务架构**：按模块拆分服务
- **容器化部署**：Docker + Kubernetes
- **实时通信**：WebSocket 支持
- **AI 增强**：更多 AI 能力集成

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于 PRD 文档生成技术方案 |

---

> 基于：[PRD 00-10 系列文档](./prd/)
> 完成：Manta-AI 技术方案