# 技术方案 02 — 工作空间 / Workspace

---

## 1. 功能概述

本文档基于 PRD 02 — 工作空间，提供 Manta 平台工作空间的**详细技术实现方案**。工作空间是智能体应用的运行环境，为每个应用提供独立的对话、上下文和记忆存储。

### 1.1 核心理念

每个智能体应用都有自己的工作空间，就像每个应用都有自己的"办公室"。工作空间包含三个核心组件：

- **对话 (Conversations)**：消息历史、工具调用记录
- **上下文 (Context)**：工作目录、文件、环境变量
- **记忆 (Memory)**：短期记忆、长期记忆、知识片段

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    工作空间 (Workspace)                        │
│                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │    对话       │  │    上下文     │  │    记忆       │      │
│   │ Conversations│  │   Context    │  │   Memory     │      │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│          │                 │                 │               │
│          │                 │                 │               │
│   ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐      │
│   │ 会话列表      │  │ 工作目录      │  │ 短期记忆      │      │
│   │ 消息历史      │  │ 文件上下文    │  │ 长期记忆      │      │
│   │ 工具调用记录  │  │ 环境变量      │  │ 知识片段      │      │
│   └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心数据结构

### 2.1 会话数据结构

```typescript
// 会话状态
type ConversationStatus = 'active' | 'archived' | 'deleted'

// 会话
interface Conversation {
  id: string                      // UUID v4
  appId: string                   // 所属应用
  title: string                   // 会话标题（从首条消息自动生成）
  messages: ConversationMessage[]
  context: ConversationContext
  status: ConversationStatus
  createdAt: string
  updatedAt: string
}

// 会话消息
interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
  metadata?: Record<string, unknown>
}

// 工具调用
interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

// 工具结果
interface ToolResult {
  toolCallId: string
  result: unknown
  error?: string
}

// 会话上下文
interface ConversationContext {
  workDir?: string                // 工作目录
  envVars?: Record<string, string> // 环境变量
  files?: string[]                // 相关文件列表
  tokensUsed: number              // 总 token 消耗
}
```

### 2.2 上下文窗口管理

```typescript
// 上下文窗口
interface ContextWindow {
  maxTokens: number               // 最大 token 数
  currentTokens: number           // 当前 token 数
  strategy: ContextCompressionStrategy
}

// 上下文压缩策略
type ContextCompressionStrategy =
  | 'truncate'    // 直接截断旧消息
  | 'summarize'   // 用 LLM 总结旧消息
  | 'sliding'     // 滑动窗口，保留最近 N 条

// 上下文管理器
interface IContextManager {
  // 获取上下文
  getContext(appId: string): Promise<ConversationContext>
  
  // 更新上下文
  updateContext(appId: string, context: Partial<ConversationContext>): Promise<void>
  
  // 管理上下文窗口
  manageContextWindow(messages: ConversationMessage[], maxTokens: number): Promise<ConversationMessage[]>
  
  // 压缩上下文
  compressContext(messages: ConversationMessage[], strategy: ContextCompressionStrategy): Promise<ConversationMessage[]>
}
```

## 3. 对话管理

### 3.1 会话生命周期

```
创建会话 → 对话交互 → 会话结束 → 归档/删除
    │          │          │          │
    │          │          │          └── 可选保留或删除
    │          │          └── 手动结束或超时
    │          └── 消息交换、工具调用、知识检索
    └── 初始化上下文、加载记忆
```

### 3.2 对话管理服务

```typescript
// services/conversation.service.ts
interface IConversationService {
  // 会话 CRUD
  create(appId: string, title?: string): Promise<Conversation>
  getById(appId: string, convId: string): Promise<Conversation | null>
  list(appId: string, filter?: ConversationFilter): Promise<Conversation[]>
  update(appId: string, convId: string, patch: UpdateConversationInput): Promise<Conversation>
  delete(appId: string, convId: string): Promise<void>
  
  // 消息管理
  addMessage(appId: string, convId: string, message: Omit<ConversationMessage, 'id' | 'timestamp'>): Promise<ConversationMessage>
  getMessages(appId: string, convId: string, limit?: number): Promise<ConversationMessage[]>
  
  // 流式消息
  streamMessage(appId: string, convId: string, message: string): AsyncGenerator<StreamChunk>
  
  // 会话操作
  archive(appId: string, convId: string): Promise<void>
  restore(appId: string, convId: string): Promise<void>
  
  // 搜索
  search(appId: string, query: string): Promise<Conversation[]>
}
```

### 3.3 流式响应实现

```typescript
// 流式响应类型
interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
  content: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  error?: string
}

// SSE 流式响应
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const appId = searchParams.get('appId')
  const convId = searchParams.get('convId')
  const message = searchParams.get('message')
  
  if (!appId || !convId || !message) {
    return new Response('Missing parameters', { status: 400 })
  }
  
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = conversationService.streamMessage(appId, convId, message)
        
        for await (const chunk of generator) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`
          controller.enqueue(encoder.encode(data))
        }
        
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        const errorChunk: StreamChunk = {
          type: 'error',
          content: 'Stream error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
        controller.close()
      }
    }
  })
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}
```

## 4. 上下文管理

### 4.1 上下文组成

| 上下文类型 | 说明 | 生命周期 |
|-----------|------|---------|
| **系统上下文** | Agent 配置、知识库绑定、工具列表 | 应用级，持久 |
| **会话上下文** | 当前对话历史、工具调用结果 | 会话级 |
| **工作目录** | 文件系统路径、相关文件 | 会话级 |
| **环境变量** | API Key、配置参数 | 应用级 |

### 4.2 上下文管理器实现

```typescript
// services/context-manager.service.ts
class ContextManager implements IContextManager {
  private fileRepository: IFileRepository<ConversationContext>
  
  constructor(fileRepository: IFileRepository<ConversationContext>) {
    this.fileRepository = fileRepository
  }
  
  async getContext(appId: string): Promise<ConversationContext> {
    const context = await this.fileRepository.get(appId)
    return context || this.getDefaultContext()
  }
  
  async updateContext(appId: string, context: Partial<ConversationContext>): Promise<void> {
    const existing = await this.getContext(appId)
    const updated = { ...existing, ...context }
    await this.fileRepository.update(appId, updated)
  }
  
  async manageContextWindow(messages: ConversationMessage[], maxTokens: number): Promise<ConversationMessage[]> {
    let totalTokens = 0
    const result: ConversationMessage[] = []
    
    // 从最新消息开始，保留尽可能多的消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      const tokens = this.estimateTokens(message.content)
      
      if (totalTokens + tokens > maxTokens) {
        break
      }
      
      totalTokens += tokens
      result.unshift(message)
    }
    
    return result
  }
  
  async compressContext(messages: ConversationMessage[], strategy: ContextCompressionStrategy): Promise<ConversationMessage[]> {
    switch (strategy) {
      case 'truncate':
        return this.truncateContext(messages)
      case 'summarize':
        return this.summarizeContext(messages)
      case 'sliding':
        return this.slidingWindowContext(messages)
      default:
        return messages
    }
  }
  
  private truncateContext(messages: ConversationMessage[]): Promise<ConversationMessage[]> {
    // 保留最近的消息，截断旧消息
    const maxMessages = 50
    if (messages.length <= maxMessages) {
      return Promise.resolve(messages)
    }
    return Promise.resolve(messages.slice(-maxMessages))
  }
  
  private async summarizeContext(messages: ConversationMessage[]): Promise<ConversationMessage[]> {
    // 使用 LLM 总结旧消息
    const maxMessages = 50
    if (messages.length <= maxMessages) {
      return messages
    }
    
    const oldMessages = messages.slice(0, -maxMessages)
    const recentMessages = messages.slice(-maxMessages)
    
    // 调用 LLM 总结
    const summary = await this.summarizeMessages(oldMessages)
    
    // 创建系统消息作为总结
    const summaryMessage: ConversationMessage = {
      id: `summary-${Date.now()}`,
      role: 'system',
      content: `Previous conversation summary: ${summary}`,
      timestamp: new Date().toISOString()
    }
    
    return [summaryMessage, ...recentMessages]
  }
  
  private slidingWindowContext(messages: ConversationMessage[]): Promise<ConversationMessage[]> {
    // 滑动窗口，保留最近 N 条
    const windowSize = 100
    if (messages.length <= windowSize) {
      return Promise.resolve(messages)
    }
    return Promise.resolve(messages.slice(-windowSize))
  }
  
  private estimateTokens(text: string): number {
    // 简单估算：1 token ≈ 4 字符
    return Math.ceil(text.length / 4)
  }
  
  private async summarizeMessages(messages: ConversationMessage[]): Promise<string> {
    // 调用 LLM 总结消息
    // 实现细节省略
    return 'Summary of previous conversation'
  }
  
  private getDefaultContext(): ConversationContext {
    return {
      workDir: process.cwd(),
      envVars: {},
      files: [],
      tokensUsed: 0
    }
  }
}
```

## 5. 记忆系统集成

### 5.1 记忆类型

| 记忆类型 | 生命周期 | 存储位置 | 说明 |
|---------|---------|---------|------|
| **短期记忆** | 会话级 | 内存 | 当前会话的上下文摘要 |
| **长期记忆** | 持久化 | 文件系统 | 跨对话的知识片段、用户偏好 |
| **工作记忆** | 任务级 | 内存 | 当前任务的临时数据 |

### 5.2 记忆检索集成

```typescript
// services/memory-integration.service.ts
interface IMemoryIntegration {
  // 检索相关记忆
  searchRelevantMemories(appId: string, query: string, topK?: number): Promise<MemorySearchResult[]>
  
  // 注入记忆到上下文
  injectMemories(context: ConversationContext, memories: MemorySearchResult[]): ConversationContext
  
  // 从对话中提取记忆
  extractMemoriesFromConversation(appId: string, messages: ConversationMessage[]): Promise<MemoryEntry[]>
}
```

## 6. API 设计

### 6.1 会话管理 API

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/apps/:appId/conversations` | 获取会话列表 |
| `POST` | `/api/apps/:appId/conversations` | 创建新会话 |
| `GET` | `/api/apps/:appId/conversations/:convId` | 获取会话详情 |
| `DELETE` | `/api/apps/:appId/conversations/:convId` | 删除会话 |
| `POST` | `/api/apps/:appId/conversations/:convId/messages` | 发送消息 |
| `GET` | `/api/apps/:appId/conversations/:convId/stream` | SSE 流式响应 |
| `GET` | `/api/apps/:appId/context` | 获取当前上下文 |
| `PUT` | `/api/apps/:appId/context` | 更新上下文 |

### 6.2 API 实现示例

```typescript
// app/api/apps/[appId]/conversations/route.ts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const appId = searchParams.get('appId')
    
    if (!appId) {
      return NextResponse.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'appId is required' }
      }, { status: 400 })
    }
    
    const filter: ConversationFilter = {
      status: searchParams.get('status') as ConversationStatus,
      search: searchParams.get('search'),
      sort: searchParams.get('sort') as SortField
    }
    
    const conversations = await conversationService.list(appId, filter)
    
    return NextResponse.json({
      success: true,
      data: conversations
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const appId = searchParams.get('appId')
    
    if (!appId) {
      return NextResponse.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'appId is required' }
      }, { status: 400 })
    }
    
    const input: CreateConversationInput = await request.json()
    const conversation = await conversationService.create(appId, input.title)
    
    return NextResponse.json({
      success: true,
      data: conversation
    }, { status: 201 })
  } catch (error) {
    return handleApiError(error)
  }
}
```

## 7. 前端组件设计

### 7.1 工作空间页面组件

```typescript
// components/workspace/WorkspacePage.tsx
interface WorkspacePageProps {
  appId: string
}

export function WorkspacePage({ appId }: WorkspacePageProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [context, setContext] = useState<ConversationContext | null>(null)
  
  useEffect(() => {
    loadConversations()
    loadContext()
  }, [appId])
  
  const loadConversations = async () => {
    const response = await fetch(`/api/apps/${appId}/conversations`)
    const data = await response.json()
    if (data.success) {
      setConversations(data.data)
    }
  }
  
  const loadContext = async () => {
    const response = await fetch(`/api/apps/${appId}/context`)
    const data = await response.json()
    if (data.success) {
      setContext(data.data)
    }
  }
  
  const handleNewConversation = async () => {
    const response = await fetch(`/api/apps/${appId}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New Conversation' })
    })
    const data = await response.json()
    if (data.success) {
      setConversations(prev => [data.data, ...prev])
      setCurrentConversation(data.data)
    }
  }
  
  const handleSendMessage = async (message: string) => {
    if (!currentConversation) return
    
    // 使用 SSE 流式响应
    const eventSource = new EventSource(
      `/api/apps/${appId}/conversations/${currentConversation.id}/stream?message=${encodeURIComponent(message)}`
    )
    
    eventSource.onmessage = (event) => {
      if (event.data === '[DONE]') {
        eventSource.close()
        return
      }
      
      const chunk: StreamChunk = JSON.parse(event.data)
      // 处理流式响应
      handleStreamChunk(chunk)
    }
    
    eventSource.onerror = () => {
      eventSource.close()
    }
  }
  
  return (
    <div className="flex h-screen">
      {/* 会话列表 */}
      <div className="w-64 border-r">
        <ConversationList
          conversations={conversations}
          currentId={currentConversation?.id}
          onSelect={setCurrentConversation}
          onNew={handleNewConversation}
        />
      </div>
      
      {/* 对话区域 */}
      <div className="flex-1 flex flex-col">
        <MessageList messages={currentConversation?.messages || []} />
        <MessageInput onSend={handleSendMessage} />
      </div>
      
      {/* 上下文面板 */}
      <div className="w-64 border-l">
        <ContextPanel context={context} />
      </div>
    </div>
  )
}
```

## 8. 异常处理

### 8.1 异常场景和处理方式

| 场景 | 处理方式 |
|------|---------|
| 会话消息过多 | 自动压缩或归档旧消息 |
| 上下文窗口溢出 | 根据策略截断/总结 |
| 工具调用失败 | 显示错误信息，允许重试 |
| 知识库检索超时 | 降级为无知识库模式 |
| 并发会话冲突 | 每个会话独立，互不干扰 |

### 8.2 错误处理实现

```typescript
// 错误类型
class WorkspaceError extends AppError {
  constructor(code: string, message: string, statusCode: number = 500) {
    super(code, message, statusCode)
    this.name = 'WorkspaceError'
  }
}

// 预定义错误
export const WorkspaceErrors = {
  CONVERSATION_NOT_FOUND: (convId: string) =>
    new WorkspaceError('CONVERSATION_NOT_FOUND', `Conversation not found: ${convId}`, 404),
  
  CONTEXT_OVERFLOW: (maxTokens: number) =>
    new WorkspaceError('CONTEXT_OVERFLOW', `Context window overflow: max tokens ${maxTokens}`, 400),
  
  TOOL_CALL_FAILED: (toolName: string, error: string) =>
    new WorkspaceError('TOOL_CALL_FAILED', `Tool call failed: ${toolName} - ${error}`, 500),
  
  MEMORY_SEARCH_TIMEOUT: () =>
    new WorkspaceError('MEMORY_SEARCH_TIMEOUT', 'Memory search timeout', 504)
}
```

## 9. 性能优化

### 9.1 会话列表优化

- **分页加载**：使用 cursor-based 分页
- **虚拟滚动**：使用 `@tanstack/react-virtual` 处理长列表
- **缓存策略**：使用 Zustand 缓存会话列表

### 9.2 消息流优化

- **流式响应**：使用 SSE 实现流式消息
- **消息压缩**：对旧消息进行压缩存储
- **懒加载**：按需加载历史消息

### 9.3 上下文优化

- **Token 估算**：使用高效的 token 估算算法
- **上下文窗口**：动态调整上下文窗口大小
- **记忆检索**：使用向量检索提高相关性

## 10. 测试策略

### 10.1 单元测试

- 会话管理服务
- 上下文管理器
- 记忆集成服务

### 10.2 集成测试

- API 端点测试
- 流式响应测试
- 会话生命周期测试

### 10.3 E2E 测试

- 完整对话流程
- 会话管理操作
- 上下文切换测试

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于 PRD 02 生成工作空间技术方案 |

---

> 基于：[PRD 02 — 工作空间](../prd/02-workspace.md)
> 上一篇：[技术方案 01 — 系统架构](./01-architecture.md)
> 下一篇：[技术方案 03 — 知识库](./03-knowledge-base.md)