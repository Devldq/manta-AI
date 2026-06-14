# 技术方案 02 — 工作空间 / Workspace

---

## 1. 功能概述

本文档基于 PRD 02 — 工作空间，提供 Manta 平台工作空间的**详细技术实现方案**。

### 1.1 核心理念

- **工作空间 (Workspace)** 是 Manta 平台的顶层运行环境，包含多个会话
- **Manta AI** 是默认的通用智能体，负责处理基础对话和任务
- **智能体应用**以 Manta AI 为基础，拓展出更强大的能力（RAG、工作流、定制系统提示词等）
- 每个工作空间可配置多个智能体应用，通过 `@应用名` 在会话中调用
- 未配置智能体应用时，由 Manta AI 直接处理消息

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    工作空间 (Workspace)                        │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                    会话列表                           │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │   │
│   │  │   会话 1      │  │   会话 2      │  │   会话 N    │ │   │
│   │  │ ┌──────────┐ │  │ ┌──────────┐ │  │            │ │   │
│   │  │ │ Manta AI │ │  │ │ 应用 A   │ │  │   ...      │ │   │
│   │  │ │ 应用 A   │ │  │ │ 应用 B   │ │  │            │ │   │
│   │  │ └──────────┘ │  │ └──────────┘ │  │            │ │   │
│   │  └──────────────┘  └──────────────┘  └────────────┘ │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │   工作空间    │  │    对话       │  │    记忆       │      │
│   │   配置       │  │ Conversations│  │   Memory     │      │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│          │                 │                 │               │
│   ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐      │
│   │ 智能体应用    │  │ 会话列表      │  │ 短期记忆      │      │
│   │ 知识库绑定    │  │ 消息历史      │  │ 长期记忆      │      │
│   │ 工作流绑定    │  │ @调用记录     │  │ 知识片段      │      │
│   └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心数据结构

### 2.1 工作空间配置

```typescript
// 工作空间配置
interface WorkspaceConfig {
  id: string                      // UUID v4
  name: string                    // 工作空间名称
  description?: string            // 描述
  agentAppIds: string[]           // 已配置的智能体应用 ID 列表
  knowledgeBaseIds: string[]      // 已绑定的知识库 ID 列表
  workflowIds: string[]           // 已绑定的工作流 ID 列表
  createdAt: string
  updatedAt: string
}

// Manta AI 配置（内置，不可删除）
interface MantaAIConfig {
  id: 'manta-ai'                  // 固定 ID
  name: 'Manta AI'
  description: '默认通用智能体'
  capabilities: ['conversation', 'qa', 'basic-tasks']
  isBuiltIn: true
}
```

### 2.2 会话数据结构

```typescript
// 会话状态
type ConversationStatus = 'active' | 'archived' | 'deleted'

// 会话
interface Conversation {
  id: string                      // UUID v4
  workspaceId: string             // 所属工作空间
  title: string                   // 会话标题（从首条消息自动生成）
  activeAgentAppIds: string[]     // 当前会话激活的智能体应用
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
  agentAppId?: string             // 响应此消息的智能体应用 ID（如 'manta-ai' 或具体应用 ID）
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
  metadata?: Record<string, unknown>
}

// @调用解析结果
interface AtMention {
  agentAppId: string              // 被@的智能体应用 ID
  agentAppName: string            // 应用名称
  startIndex: number              // 在消息中的起始位置
  endIndex: number                // 在消息中的结束位置
}
```

### 2.3 上下文窗口管理

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
```

// 上下文管理器
interface IContextManager {
  // 获取上下文
  getContext(workspaceId: string): Promise<ConversationContext>
  
  // 更新上下文
  updateContext(workspaceId: string, context: Partial<ConversationContext>): Promise<void>
  
  // 管理上下文窗口
  manageContextWindow(messages: ConversationMessage[], maxTokens: number): Promise<ConversationMessage[]>
  
  // 压缩上下文
  compressContext(messages: ConversationMessage[], strategy: ContextCompressionStrategy): Promise<ConversationMessage[]>
}
```

## 3. 核心服务

### 3.1 工作空间配置服务

```typescript
// services/workspace.service.ts
interface IWorkspaceService {
  // 工作空间 CRUD
  get(): Promise<WorkspaceConfig>
  update(patch: UpdateWorkspaceInput): Promise<WorkspaceConfig>
  
  // 智能体应用配置
  addAgentApp(agentAppId: string): Promise<void>
  removeAgentApp(agentAppId: string): Promise<void>
  listAgentApps(): Promise<AgentAppConfig[]>
  
  // 知识库绑定
  bindKnowledgeBase(kbId: string): Promise<void>
  unbindKnowledgeBase(kbId: string): Promise<void>
  listKnowledgeBases(): Promise<KnowledgeBaseConfig[]>
  
  // 工作流绑定
  bindWorkflow(workflowId: string): Promise<void>
  unbindWorkflow(workflowId: string): Promise<void>
  listWorkflows(): Promise<WorkflowConfig[]>
}
```

### 3.2 @调用解析服务

```typescript
// services/at-mention.service.ts
interface IAtMentionService {
  // 解析消息中的@调用
  parseAtMentions(message: string): AtMention[]
  
  // 获取被@的智能体应用
  getAgentApps(mentions: AtMention[]): Promise<AgentAppConfig[]>
  
  // 路由消息到对应的智能体应用
  routeMessage(message: string, mentions: AtMention[]): MessageRouting
}

// 消息路由结果
interface MessageRouting {
  // 默认由 Manta AI 处理
  defaultHandler: 'manta-ai'
  // 被@的智能体应用列表
  targetedAgents: {
    agentAppId: string
    messageFragment: string  // 该应用负责处理的消息片段
  }[]
}
```

### 3.3 会话生命周期

```
创建会话 → 对话交互 → 会话结束 → 归档/删除
    │          │          │          │
    │          │          │          └── 可选保留或删除
    │          │          └── 手动结束或超时
    │          └── 消息交换、@调用、工具调用、知识检索
    └── 初始化上下文、加载工作空间配置
```

### 3.4 对话管理服务

```typescript
// services/conversation.service.ts
interface IConversationService {
  // 会话 CRUD
  create(workspaceId: string, title?: string): Promise<Conversation>
  getById(workspaceId: string, convId: string): Promise<Conversation | null>
  list(workspaceId: string, filter?: ConversationFilter): Promise<Conversation[]>
  update(workspaceId: string, convId: string, patch: UpdateConversationInput): Promise<Conversation>
  delete(workspaceId: string, convId: string): Promise<void>
  
  // 消息管理
  addMessage(workspaceId: string, convId: string, message: Omit<ConversationMessage, 'id' | 'timestamp'>): Promise<ConversationMessage>
  getMessages(workspaceId: string, convId: string, limit?: number): Promise<ConversationMessage[]>
  
  // 流式消息（支持@调用）
  streamMessage(workspaceId: string, convId: string, message: string): AsyncGenerator<StreamChunk>
  
  // 会话操作
  archive(workspaceId: string, convId: string): Promise<void>
  restore(workspaceId: string, convId: string): Promise<void>
  
  // 搜索
  search(workspaceId: string, query: string): Promise<Conversation[]>
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

### 6.1 工作空间配置 API

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/workspace` | 获取工作空间配置 |
| `PUT` | `/api/workspace` | 更新工作空间配置 |
| `GET` | `/api/workspace/agent-apps` | 获取已配置的智能体应用列表 |
| `POST` | `/api/workspace/agent-apps` | 添加智能体应用到工作空间 |
| `DELETE` | `/api/workspace/agent-apps/:appId` | 从工作空间移除智能体应用 |
| `GET` | `/api/workspace/knowledge-bases` | 获取已绑定的知识库列表 |
| `POST` | `/api/workspace/knowledge-bases` | 绑定知识库到工作空间 |
| `DELETE` | `/api/workspace/knowledge-bases/:kbId` | 解绑知识库 |
| `GET` | `/api/workspace/workflows` | 获取已绑定的工作流列表 |
| `POST` | `/api/workspace/workflows` | 绑定工作流到工作空间 |
| `DELETE` | `/api/workspace/workflows/:workflowId` | 解绑工作流 |

### 6.2 会话管理 API

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/conversations` | 获取会话列表 |
| `POST` | `/api/conversations` | 创建新会话 |
| `GET` | `/api/conversations/:convId` | 获取会话详情 |
| `DELETE` | `/api/conversations/:convId` | 删除会话 |
| `POST` | `/api/conversations/:convId/messages` | 发送消息（支持@调用） |
| `GET` | `/api/conversations/:convId/stream` | SSE 流式响应 |

### 6.3 API 实现示例

```typescript
// app/api/conversations/route.ts
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    
    const filter: ConversationFilter = {
      status: searchParams.get('status') as ConversationStatus,
      search: searchParams.get('search'),
      sort: searchParams.get('sort') as SortField
    }
    
    const conversations = await conversationService.list(filter)
    
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
    const input: CreateConversationInput = await request.json()
    const conversation = await conversationService.create(input.title)
    
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

### 7.1 整体布局

采用侧边栏导航布局：

```typescript
// components/layout/AppLayout.tsx
export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      {/* 侧边栏 */}
      <Sidebar />
      
      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

// components/layout/Sidebar.tsx
export function Sidebar() {
  return (
    <nav className="w-64 border-r bg-gray-50">
      <div className="p-4">
        <h1 className="text-xl font-bold">Manta</h1>
      </div>
      
      <ul className="space-y-1 px-2">
        <SidebarItem href="/conversations" icon={MessageSquare} label="会话" />
        <SidebarItem href="/workspace" icon={Settings} label="工作空间" />
        <SidebarItem href="/apps" icon={Bot} label="智能体应用" />
        <SidebarItem href="/rag" icon={Database} label="知识库" />
        <SidebarItem href="/workflow" icon={GitBranch} label="工作流" />
      </ul>
    </nav>
  )
}
```

### 7.2 会话页面组件

```typescript
// components/conversations/ConversationsPage.tsx
export function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  
  useEffect(() => {
    loadConversations()
  }, [])
  
  const loadConversations = async () => {
    const response = await fetch('/api/conversations')
    const data = await response.json()
    if (data.success) {
      setConversations(data.data)
    }
  }
  
  const handleNewConversation = async () => {
    const response = await fetch('/api/conversations', {
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
      `/api/conversations/${currentConversation.id}/stream?message=${encodeURIComponent(message)}`
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
    <div className="flex h-full">
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
| 工作空间配置无效 | 验证配置并返回详细错误信息 |
| 智能体应用不存在 | 提示用户应用不存在或已删除 |
| @调用解析失败 | 降级为 Manta AI 处理 |
| 工作空间资源不足 | 提示用户清理资源或升级配置 |

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
    new WorkspaceError('MEMORY_SEARCH_TIMEOUT', 'Memory search timeout', 504),
  
  WORKSPACE_NOT_FOUND: (workspaceId: string) =>
    new WorkspaceError('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceId}`, 404),
  
  WORKSPACE_CONFIG_INVALID: (details: string) =>
    new WorkspaceError('WORKSPACE_CONFIG_INVALID', `Workspace configuration invalid: ${details}`, 400),
  
  AGENT_APP_NOT_FOUND: (appId: string) =>
    new WorkspaceError('AGENT_APP_NOT_FOUND', `Agent application not found: ${appId}`, 404),
  
  AT_MENTION_PARSE_FAILED: (message: string) =>
    new WorkspaceError('AT_MENTION_PARSE_FAILED', `Failed to parse @mention in message: ${message}`, 400)
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

### 9.4 工作空间优化

- **配置缓存**：缓存工作空间配置，减少数据库查询
- **智能体应用预加载**：预加载常用智能体应用配置
- **资源池化**：共享知识库和工作流实例，减少资源消耗

## 10. 测试策略

### 10.1 单元测试

- 会话管理服务
- 上下文管理器
- 记忆集成服务
- 工作空间配置服务
- @调用解析服务

### 10.2 集成测试

- API 端点测试
- 流式响应测试
- 会话生命周期测试
- 工作空间配置管理测试
- 智能体应用绑定测试

### 10.3 E2E 测试

- 完整对话流程
- 会话管理操作
- 上下文切换测试
- 工作空间配置流程
- @调用智能体应用流程

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于 PRD 02 生成工作空间技术方案 |
| 2026-06-14 | v1.1 | 更新工作空间概念，添加 Manta AI、@调用机制、侧边栏布局、工作空间配置服务 |

---

> 基于：[PRD 02 — 工作空间](../prd/02-workspace.md)
> 上一篇：[技术方案 01 — 系统架构](./01-architecture.md)
> 下一篇：[技术方案 03 — 知识库](./03-knowledge-base.md)