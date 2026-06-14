# PRD 02 — 工作空间 / Workspace

---

## 中文版

### 1. 功能概述

**工作空间**是智能体应用的运行环境，为每个应用提供独立的对话、上下文和记忆存储。

核心理念：每个智能体应用都有自己的工作空间，就像每个应用都有自己的"办公室"。

### 2. 核心概念

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

### 3. 对话管理

#### 3.1 会话生命周期

```
创建会话 → 对话交互 → 会话结束 → 归档/删除
    │          │          │          │
    │          │          │          └── 可选保留或删除
    │          │          └── 手动结束或超时
    │          └── 消息交换、工具调用、知识检索
    └── 初始化上下文、加载记忆
```

#### 3.2 会话数据结构

```typescript
interface Conversation {
  id: string                      // UUID v4
  appId: string                   // 所属应用
  title: string                   // 会话标题（从首条消息自动生成）
  messages: ConversationMessage[]
  context: ConversationContext
  status: 'active' | 'archived' | 'deleted'
  createdAt: string
  updatedAt: string
}

interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
  metadata?: Record<string, unknown>
}

interface ConversationContext {
  workDir?: string                // 工作目录
  envVars?: Record<string, string> // 环境变量
  files?: string[]                // 相关文件列表
  tokensUsed: number              // 总 token 消耗
}
```

#### 3.3 会话列表页

```
┌──────────────────────────────────────────────────────────┐
│  工作空间 — 简历筛选 Agent                   [+ 新建会话]  │
├──────────────────────────────────────────────────────────┤
│  ┌── 搜索会话... ──────────────────┐  ┌ 排序 ▼ ─┐        │
│  └─────────────────────────────────┘  └─────────┘        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 💬 筛选前端简历                          2h前       │  │
│  │    "请帮我筛选这批简历中符合条件的候选人..."          │  │
│  │    15 条消息 · 3 次工具调用                          │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 💬 分析候选人背景                          1d前       │  │
│  │    "这位候选人的项目经验如何？"                       │  │
│  │    8 条消息 · 1 次知识检索                           │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 💬 生成面试问题                            3d前       │  │
│  │    "根据JD生成面试问题"                              │  │
│  │    12 条消息 · 2 次工具调用                          │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 4. 上下文管理

#### 4.1 上下文组成

| 上下文类型 | 说明 | 生命周期 |
|-----------|------|---------|
| **系统上下文** | Agent 配置、知识库绑定、工具列表 | 应用级，持久 |
| **会话上下文** | 当前对话历史、工具调用结果 | 会话级 |
| **工作目录** | 文件系统路径、相关文件 | 会话级 |
| **环境变量** | API Key、配置参数 | 应用级 |

#### 4.2 上下文窗口管理

```typescript
interface ContextWindow {
  maxTokens: number               // 最大 token 数
  currentTokens: number           // 当前 token 数
  strategy: 'truncate' | 'summarize' | 'sliding' // 窗口策略
}

// 上下文压缩策略
type ContextCompressionStrategy =
  | 'truncate'    // 直接截断旧消息
  | 'summarize'   // 用 LLM 总结旧消息
  | 'sliding'     // 滑动窗口，保留最近 N 条
```

### 5. 记忆系统

详见 [PRD 07 — 记忆系统](./07-memory-system.md)

简要说明：
- **短期记忆**：当前会话的上下文摘要
- **长期记忆**：跨对话的知识片段、用户偏好
- **记忆检索**：根据当前对话内容检索相关记忆

### 6. 页面结构

#### 6.1 工作空间主页 `/apps/[id]/workspace`

```
┌──────────────────────────────────────────────────────────┐
│  ← 返回应用   简历筛选 Agent — 工作空间      [设置] [···]  │
├──────────────┬───────────────────────────────────────────┤
│  会话列表     │                                           │
│              │   对话区域                                  │
│  [新建会话]   │   ┌─────────────────────────────────────┐ │
│              │   │ 🤖 你好！我是简历筛选助手。           │ │
│  💬 会话 1    │   │    请上传需要筛选的简历...            │ │
│  💬 会话 2    │   │                                     │ │
│  💬 会话 3    │   │ 👤 请帮我筛选这批简历                │ │
│              │   │                                     │ │
│              │   │ 🤖 好的，我来帮你筛选...             │ │
│              │   │    [调用工具: file_read]              │ │
│              │   │    [检索知识库: 简历模板库]            │ │
│              │   │                                     │ │
│              │   │ ┌─────────────────────────────────┐ │ │
│              │   │ │ 输入消息...          [发送]      │ │ │
│              │   │ └─────────────────────────────────┘ │ │
│              │   └─────────────────────────────────────┘ │
│              │                                           │
│  ────────────│   上下文信息                                │
│  知识库       │   📚 简历模板库 (120 文档)                  │
│  工具         │   🛠️ file_read, web_search                │
│  工作目录     │   📁 /Users/.../resumes                   │
└──────────────┴───────────────────────────────────────────┘
```

### 7. API 设计

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

### 8. 异常处理

| 场景 | 处理方式 |
|------|---------|
| 会话消息过多 | 自动压缩或归档旧消息 |
| 上下文窗口溢出 | 根据策略截断/总结 |
| 工具调用失败 | 显示错误信息，允许重试 |
| 知识库检索超时 | 降级为无知识库模式 |
| 并发会话冲突 | 每个会话独立，互不干扰 |

---

## English Version

### 1. Feature Overview

**Workspace** is the runtime environment for agent apps, providing independent dialogue, context, and memory storage for each app.

### 2. Core Concepts

- **Conversations**: Message history, tool call records
- **Context**: Work directory, files, environment variables
- **Memory**: Short-term (session) + long-term (cross-session)

### 3. Conversation Management

Sessions have a lifecycle: Create → Interact → End → Archive/Delete. Each session maintains its own message history and context.

### 4. Context Management

Context types: System context (app-level), Session context (conversation-level), Work directory, Environment variables.

Context window strategies: truncate, summarize, sliding window.

### 5. Memory System

See [PRD 07 — Memory System](./07-memory-system.md)

### 6. API Design

8 endpoints for conversation CRUD, message sending, SSE streaming, and context management.

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，定义工作空间核心功能 |

---

> 上一篇：[PRD 01 — 系统架构](./01-architecture.md)
> 下一篇：[PRD 03 — 知识库](./03-knowledge-base.md)
