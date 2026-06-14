# 技术方案 01 — 系统架构 / System Architecture

---

## 1. 架构概述

本文档基于 PRD 01 — 系统架构，提供 Manta 平台的**详细技术架构设计**。采用分层架构，确保系统的可维护性、可扩展性和高性能。

### 1.1 架构原则

- **分层解耦**：每层职责明确，依赖向下传递
- **模块化设计**：高内聚低耦合，便于独立开发和测试
- **渐进增强**：基于现有代码库，不破坏已有功能
- **本地优先**：v1 阶段所有数据存储在本地

### 1.2 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        UI 层 (Next.js App Router)                      │
│  ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  会话页   │ │ 工作空间 │ │ 智能体应用│ │ 知识库  │ │   工作流    │  │
│  │/conversa-│ │/workspace│ │  /apps   │ │  /rag   │ │ /workflow   │  │
│  │  tions   │ │         │ │          │ │         │ │             │  │
│  └──────────┘ └─────────┘ └──────────┘ └─────────┘ └─────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                       API 层 (REST + SSE)                             │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐   │
│  │/api/     │ │/api/     │ │/api/work- │ │/api/    │ │/api/eval│   │
│  │conversa- │ │workspace │ │  flow     │ │  rag    │ │         │   │
│  │tions     │ │          │ │           │ │         │ │         │   │
│  └──────────┘ └──────────┘ └───────────┘ └─────────┘ └─────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                      应用层 / Application Layer                        │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────┐│
│  │ Manta AI      │ │ Workspace     │ │ AppManager    │ │ AppBuilder││
│  │ 通用智能体     │ │ 工作空间管理   │ │ 应用CRUD管理  │ │ 应用搭建  ││
│  └───────────────┘ └───────────────┘ └───────────────┘ └───────────┘│
├──────────────────────────────────────────────────────────────────────┤
│                      引擎层 / Engine Layer                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Agent Loop│ │Workflow  │ │RAG Engine│ │Eval Engine│ │ Memory   │  │
│  │ (已有)   │ │ Engine   │ │ (已有)   │ │          │ │ System   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│               存储层 / Storage Layer                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │
│  │DataStore │ │ ~/.manta │ │ ~/.manta │ │ ~/.manta-data/apps/    │  │
│  │ (已有)   │ │ -data/   │ │ -data/   │ │ {app-id}/              │  │
│  │          │ │ (已有)   │ │ rag/     │ │ 独立应用数据目录         │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. 分层架构详解

### 2.1 UI 层（Presentation Layer）

**技术栈**：Next.js 15 App Router + React 19 + TypeScript

**职责**：
- 页面路由和布局
- 用户交互和表单处理
- 状态管理和数据展示
- 响应式设计和主题支持

**目录结构**：
```
src/app/
├── (dashboard)/              # 仪表板布局
│   ├── apps/                 # 应用管理页面
│   │   ├── page.tsx          # 应用列表
│   │   └── [id]/             # 应用详情
│   │       ├── page.tsx      # 应用详情页
│   │       ├── builder/      # 应用搭建器
│   │       └── workspace/    # 工作空间
│   ├── rag/                  # 知识库页面
│   │   ├── page.tsx          # 知识库列表
│   │   └── [id]/             # 知识库详情
│   ├── workflow/             # 工作流页面
│   │   ├── page.tsx          # 工作流列表
│   │   └── [id]/             # 工作流详情
│   │       └── editor/       # 工作流编辑器
│   └── evaluation/           # 评估中心页面
│       ├── page.tsx          # 评估列表
│       └── [id]/             # 评估详情
├── api/                      # API 路由
│   ├── apps/                 # 应用管理 API
│   ├── rag/                  # 知识库 API
│   ├── workflow/             # 工作流 API
│   ├── eval/                 # 评估 API
│   └── chat/                 # 对话 API (已有)
└── layout.tsx                # 根布局
```

### 2.2 API 层（API Layer）

**技术栈**：Next.js Route Handlers + REST + SSE

**职责**：
- RESTful API 端点
- 请求验证和错误处理
- 业务逻辑调用
- 流式响应（SSE）

**API 路由规划**：
```typescript
// 应用管理
GET    /api/apps              # 获取应用列表
POST   /api/apps              # 创建应用
GET    /api/apps/:id          # 获取应用详情
PUT    /api/apps/:id          # 更新应用
DELETE /api/apps/:id          # 删除应用
POST   /api/apps/:id/clone    # 复制应用
PATCH  /api/apps/:id/status   # 更改状态

// 知识库管理
GET    /api/rag/knowledge-bases           # 获取知识库列表
POST   /api/rag/knowledge-bases           # 创建知识库
GET    /api/rag/knowledge-bases/:id       # 获取知识库详情
PUT    /api/rag/knowledge-bases/:id       # 更新知识库
DELETE /api/rag/knowledge-bases/:id       # 删除知识库
GET    /api/rag/knowledge-bases/:id/documents  # 获取文档列表
POST   /api/rag/knowledge-bases/:id/documents  # 上传文档
DELETE /api/rag/knowledge-bases/:id/documents/:docId  # 删除文档
POST   /api/rag/knowledge-bases/:id/documents/:docId/process  # 处理文档
POST   /api/rag/knowledge-bases/:id/search  # 检索测试
GET    /api/rag/providers               # 获取 Provider 列表

// 工作流管理
GET    /api/workflow          # 获取工作流列表
POST   /api/workflow          # 创建工作流
GET    /api/workflow/:id      # 获取工作流详情
PUT    /api/workflow/:id      # 更新工作流
DELETE /api/workflow/:id      # 删除工作流
POST   /api/workflow/:id/run  # 启动执行
GET    /api/workflow/:id/executions  # 获取执行历史
GET    /api/workflow/executions/:execId  # 获取执行详情
POST   /api/workflow/executions/:execId/approve  # 审批步骤

// 对话管理
GET    /api/apps/:appId/conversations  # 获取会话列表
POST   /api/apps/:appId/conversations  # 创建会话
GET    /api/apps/:appId/conversations/:convId  # 获取会话详情
DELETE /api/apps/:appId/conversations/:convId  # 删除会话
POST   /api/apps/:appId/conversations/:convId/messages  # 发送消息
GET    /api/apps/:appId/conversations/:convId/stream  # SSE 流式响应
GET    /api/apps/:appId/context  # 获取上下文
PUT    /api/apps/:appId/context  # 更新上下文

// 记忆管理
GET    /api/apps/:appId/memory  # 获取记忆列表
POST   /api/apps/:appId/memory  # 创建记忆
GET    /api/apps/:appId/memory/:id  # 获取记忆详情
PUT    /api/apps/:appId/memory/:id  # 更新记忆
DELETE /api/apps/:appId/memory/:id  # 删除记忆
POST   /api/apps/:appId/memory/search  # 检索记忆
POST   /api/apps/:appId/memory/cleanup  # 清理记忆

// 评估管理
GET    /api/eval              # 获取评估列表
POST   /api/eval/start        # 启动评估
GET    /api/eval/:id          # 获取评估详情
GET    /api/eval/:id/stream   # SSE 评估进度
POST   /api/eval/:id/cancel   # 取消评估
DELETE /api/eval/:id          # 删除评估
GET    /api/eval/datasets     # 获取数据集列表
POST   /api/eval/datasets     # 创建数据集
GET    /api/eval/datasets/:id # 获取数据集详情
PUT    /api/eval/datasets/:id # 更新数据集
DELETE /api/eval/datasets/:id # 删除数据集
POST   /api/eval/datasets/import  # 导入数据集
```

### 2.3 应用层（Application Layer）

**职责**：
- 业务逻辑封装
- 业务流程编排
- 事务管理
- 权限控制

**核心模块**：

#### 2.3.1 AppManager（应用管理器）

```typescript
// services/app-manager.service.ts
interface IAppManager {
  // 应用生命周期
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
```

#### 2.3.2 AppBuilder（应用搭建器）

```typescript
// services/app-builder.service.ts
interface IAppBuilder {
  // 配置管理
  getBuilderConfig(appId: string): Promise<BuilderConfig>
  updateAgentConfig(appId: string, config: AgentConfig): Promise<void>
  updateRagBinding(appId: string, binding: RagBinding): Promise<void>
  updateWorkflowBinding(appId: string, workflowId: string): Promise<void>
  updateTools(appId: string, tools: string[]): Promise<void>
  updateAutomations(appId: string, automations: Automation[]): Promise<void>
  
  // 验证
  validateConfig(appId: string): Promise<ValidationResult>
  previewConfig(appId: string): Promise<PreviewResult>
}
```

#### 2.3.3 Workspace（工作空间）

```typescript
// services/workspace.service.ts
interface IWorkspace {
  // 对话管理
  createConversation(appId: string): Promise<Conversation>
  getConversations(appId: string): Promise<Conversation[]>
  getConversation(appId: string, convId: string): Promise<Conversation>
  deleteConversation(appId: string, convId: string): Promise<void>
  
  // 消息管理
  sendMessage(appId: string, convId: string, message: string): Promise<void>
  streamMessage(appId: string, convId: string, message: string): AsyncGenerator<Chunk>
  
  // 上下文管理
  getContext(appId: string): Promise<ConversationContext>
  updateContext(appId: string, context: Partial<ConversationContext>): Promise<void>
  
  // 记忆管理
  searchMemory(appId: string, query: string): Promise<MemorySearchResult[]>
  saveMemory(appId: string, memory: MemoryEntry): Promise<void>
}
```

### 2.4 引擎层（Engine Layer）

**职责**：
- 核心算法实现
- 外部服务集成
- 数据处理流水线
- 异步任务执行

**核心引擎**：

#### 2.4.1 Agent Loop（智能体循环，已有）

```typescript
// engines/agent/agent-loop.ts
interface IAgentLoop {
  execute(task: Task, context: AgentContext): Promise<AgentResult>
  stream(task: Task, context: AgentContext): AsyncGenerator<AgentChunk>
}
```

#### 2.4.2 Workflow Engine（工作流引擎）

```typescript
// engines/workflow/workflow-engine.ts
interface IWorkflowEngine {
  // 执行管理
  execute(workflowId: string, params: Record<string, unknown>): Promise<WorkflowExecution>
  getExecution(execId: string): Promise<WorkflowExecution>
  cancelExecution(execId: string): Promise<void>
  
  // 步骤执行
  executeStep(step: WorkflowStep, context: WorkflowContext): Promise<StepResult>
  approveStep(execId: string, stepId: string, approval: Approval): Promise<void>
  
  // 状态管理
  updateExecutionStatus(execId: string, status: WorkflowExecutionStatus): Promise<void>
  getExecutionLogs(execId: string): Promise<StepLog[]>
}
```

#### 2.4.3 RAG Engine（知识库引擎）

```typescript
// engines/rag/rag-engine.ts
interface IRagEngine {
  // Provider 管理
  getProviders(): Promise<RagProvider[]>
  getProvider(id: string): Promise<RagProvider>
  
  // 文档处理
  processDocument(kbId: string, file: File): Promise<ProcessingResult>
  deleteDocument(kbId: string, docId: string): Promise<void>
  
  // 检索
  search(kbId: string, query: string, options?: SearchOptions): Promise<SearchResult[]>
  hybridSearch(kbId: string, query: string, options?: HybridSearchOptions): Promise<SearchResult[]>
  
  // 索引管理
  rebuildIndex(kbId: string): Promise<void>
  getStats(kbId: string): Promise<RagStats>
}
```

#### 2.4.4 Eval Engine（评估引擎）

```typescript
// engines/eval/eval-engine.ts
interface IEvalEngine {
  // RAG 评估
  evaluateRag(dataset: RagEvalDataset, config: EvalConfig): Promise<RagEvalResult>
  
  // Agent 评估
  evaluateAgent(dataset: AgentEvalDataset, config: EvalConfig): Promise<AgentEvalResult>
  
  // 维度计算
  calculateDimensions(entry: EvalEntry, result: EvalResult): Promise<DimensionScores>
  
  // 报告生成
  generateReport(evalId: string): Promise<EvalReport>
}
```

#### 2.4.5 Memory System（记忆系统）

```typescript
// engines/memory/memory-system.ts
interface IMemorySystem {
  // 记忆管理
  save(entry: MemoryEntry): Promise<void>
  get(id: string): Promise<MemoryEntry | null>
  update(id: string, patch: Partial<MemoryEntry>): Promise<void>
  delete(id: string): Promise<void>
  
  // 记忆检索
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>
  
  // 记忆提取
  extractFromConversation(messages: ConversationMessage[]): Promise<MemoryEntry[]>
  
  // 记忆维护
  cleanup(): Promise<number>
  compress(): Promise<void>
}
```

### 2.5 存储层（Storage Layer）

**职责**：
- 数据持久化
- 数据索引和检索
- 数据备份和恢复
- 数据迁移

**存储架构**：

```
~/.manta-data/
├── apps/                        # 应用数据根目录
│   └── {app-id}/                # 单个应用空间
│       ├── app.json             # 应用配置
│       ├── conversations/       # 对话数据
│       │   └── {conv-id}.json
│       ├── knowledge/           # 知识库数据
│       │   ├── kb.json          # 知识库配置
│       │   ├── documents/       # 原始文档
│       │   │   ├── {doc-id}.pdf
│       │   │   └── ...
│       │   ├── chunks/          # 分块数据
│       │   │   ├── {chunk-id}.json
│       │   │   └── ...
│       │   └── index/           # 向量索引
│       │       ├── sqlite-vec.db
│       │       └── ...
│       ├── workflows/           # 工作流数据
│       │   ├── {workflow-id}.json
│       │   └── executions/      # 执行历史
│       │       ├── {exec-id}.json
│       │       └── ...
│       ├── memory/              # 记忆数据
│       │   ├── short-term.json
│       │   ├── long-term.json
│       │   └── working.json
│       ├── evaluations/         # 评估结果
│       │   ├── {eval-id}.json
│       │   └── datasets/        # 评估数据集
│       │       ├── {dataset-id}.json
│       │       └── ...
│       ├── tools/               # 工具配置
│       │   └── enabled.json
│       └── logs/                # 应用级日志
│           ├── {date}.log
│           └── ...
├── rag/                         # 共享 RAG 配置
│   ├── providers.json           # Provider 配置
│   └── models.json              # Embedding 模型配置
├── agents/                      # Agent 注册表
│   ├── registry.json
│   └── definitions/             # Agent 定义文件
│       ├── {agent-name}/
│       │   ├── SOUL.md
│       │   └── config.json
│       └── ...
├── workflows/                   # 全局工作流定义
│   ├── {workflow-id}.json
│   └── ...
└── config/                      # 全局配置
    ├── settings.json
    └── themes/
```

## 3. 数据流设计

### 3.1 请求处理流程

```
用户请求 → Next.js Route Handler → 验证 → 业务逻辑 → 数据访问 → 响应
    │           │                │        │          │        │
    │           │                │        │          │        └── JSON/SSE
    │           │                │        │          └── Repository
    │           │                │        └── Service
    │           │                └── Validation
    │           └── Router
    └── HTTP
```

### 3.2 前后端交互模式

```typescript
// 前端状态管理
const useAppStore = create<AppState>((set, get) => ({
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

// API 客户端封装
class ApiClient {
  private baseUrl: string
  
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }
  
  async get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    const url = new URL(path, this.baseUrl)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value)
      })
    }
    
    const response = await fetch(url.toString())
    return response.json()
  }
  
  async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return response.json()
  }
  
  // ... 其他方法
}
```

## 4. 核心类型映射

### 4.1 现有类型（`src/core/types.ts`）

| 类型 | 说明 | PRD 文档 |
|------|------|---------|
| `Task` | 任务对象（轻量/工作流模式） | PRD 04 - 工作流 |
| `WorkflowDef` | 工作流定义 | PRD 04 - 工作流 |
| `WorkflowStep` | 工作流步骤 | PRD 04 - 工作流 |
| `WorkflowExecution` | 工作流执行实例 | PRD 04 - 工作流 |
| `AgentEntry` | Agent 注册表条目 | PRD 05 - 智能体应用 |
| `AppConfig` | 应用配置 | PRD 05 - 智能体应用 |
| `RagBinding` | RAG 知识库绑定 | PRD 03 - 知识库 |
| `Automation` | 自动化任务 | PRD 05 - 智能体应用 |

### 4.2 新增类型

```typescript
// 应用状态
type AppStatus = 'draft' | 'published' | 'archived'

// Agent 参数覆盖
interface AgentOverride {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  model?: string
}

// RAG 知识库绑定
interface RagBinding {
  knowledgeBaseId: string
  topK: number
  similarityThreshold: number
  hybridSearchEnabled: boolean
  vectorWeight: number
}

// 自动化任务
interface Automation {
  id: string
  type: 'cron' | 'webhook' | 'manual'
  name: string
  description?: string
  enabled: boolean
  cronExpression?: string
  timezone?: string
  webhookUrl?: string
  webhookSecret?: string
  templateMessage?: string
  createdAt: string
  updatedAt: string
  lastTriggeredAt?: string
}

// 应用配置
interface AppConfig {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  status: AppStatus

  // Agent 绑定
  agentId: string
  agentOverride: AgentOverride

  // 知识库绑定
  ragBinding: RagBinding | null

  // 工作流绑定
  workflowId?: string

  // 启用的工具
  enabledTools: string[]

  // 自动化
  automations: Automation[]

  // 时间戳
  createdAt: string
  updatedAt: string
  publishedAt: string | null

  // 版本号（乐观锁）
  version: number
}
```

## 5. 技术约束

### 5.1 兼容性约束

- **现有功能**：不影响 `/tasks`、`/mcp`、`/settings` 页面的功能
- **渐进增强**：现有 Agent 运行能力保持不变，应用层是上层封装
- **Electron 兼容**：所有功能在 Electron 桌面端同样可用

### 5.2 性能目标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| **首屏加载** | < 1s | Lighthouse Performance |
| **API 响应** | < 500ms | 95th percentile |
| **内存使用** | < 512MB | 运行时监控 |
| **构建时间** | < 30s | CI/CD 流水线 |

### 5.3 安全要求

- **数据本地**：v1 阶段所有数据存储在本地，不依赖云服务
- **输入验证**：所有用户输入进行验证和清理
- **错误处理**：不泄露敏感信息
- **文件权限**：数据目录权限设置为 700

## 6. 实现要点

### 6.1 渐进增强策略

1. **保持现有功能**：不修改现有 `/tasks`、`/mcp`、`/settings` 页面
2. **封装现有能力**：将现有 Agent Loop 封装为引擎层
3. **新增应用层**：在引擎层之上添加应用管理层
4. **独立数据存储**：使用 `~/.manta-data/` 目录，与现有数据隔离

### 6.2 模块化设计

1. **服务层分离**：每个模块有独立的 Service 类
2. **依赖注入**：通过接口定义依赖关系
3. **事件驱动**：使用 EventEmitter 进行模块间通信
4. **插件架构**：支持 RAG Provider、工具等插件扩展

### 6.3 错误处理

```typescript
// 错误类型定义
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

// API 错误处理
export async function handleApiError(error: unknown): Promise<NextResponse> {
  if (error instanceof AppError) {
    return NextResponse.json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    }, { status: error.statusCode })
  }
  
  console.error('Unhandled error:', error)
  return NextResponse.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error'
    }
  }, { status: 500 })
}
```

## 7. 部署架构

### 7.1 开发环境

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

### 7.2 生产环境

```bash
# 构建
pnpm build

# 启动
pnpm start

# 环境变量
NEXT_PUBLIC_API_URL=https://api.example.com
DATABASE_URL=sqlite:./data.db
```

### 7.3 Docker 部署

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

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于 PRD 01 生成系统架构技术方案 |

---

> 基于：[PRD 01 — 系统架构](../prd/01-architecture.md)
> 上一篇：[技术方案 00 — 项目概述](./00-overview.md)
> 下一篇：[技术方案 02 — 工作空间](./02-workspace.md)