# PRD 02 — 工作空间 / Workspace

---

## 中文版

### 1. 功能概述

**工作空间 (Workspace)** 是 Manta 平台的顶层运行环境，包含多个会话，每个会话中支持一个或多个智能体应用进行对话完成任务。

核心理念：
- 工作空间是用户的"工作台"，会话是独立的"任务对话"
- **Manta AI** 是默认的通用智能体，负责处理所有基础对话和任务
- **智能体应用**以 Manta AI 为基础，拓展出更强大的能力（RAG、工作流、定制系统提示词等）
- 每个工作空间可配置多个智能体应用，通过 `@应用名` 在会话中调用
- 未配置智能体应用时，由 Manta AI 直接处理消息

### 2. 核心概念

#### 2.1 Manta AI（通用智能体）

**Manta AI** 是 Manta 平台的默认通用智能体，是所有会话的基础：
- 当工作空间未配置任何智能体应用时，所有消息由 Manta AI 处理
- Manta AI 具备基础对话、问答、简单任务处理能力
- 用户也可以在会话中通过 `@Manta AI` 显式调用
- 智能体应用以 Manta AI 为基础，拓展出更强大的能力

#### 2.2 智能体应用

**智能体应用 (Agent App)** 以 Manta AI 为基础，拓展出更强大的专业能力：

| 能力 | Manta AI（基础） | 智能体应用（拓展） |
|------|-----------------|-------------------|
| 对话能力 | ✅ 基础对话 | ✅ 继承 Manta AI 对话能力 |
| 知识库 (RAG) | ❌ | ✅ 绑定专属知识库，增强领域知识 |
| 工作流 (Workflow) | ❌ | ✅ 定义复杂任务流程，自动化执行 |
| 系统提示词 | 通用提示词 | ✅ 定制专业领域提示词 |
| 工具能力 | 基础工具 | ✅ 按需启用专业工具 |
| 发布分享 | ❌ | ✅ 可发布为独立应用分享 |

#### 2.3 @调用机制

在会话中通过 `@` 符号指定智能体应用处理消息：

```
┌─────────────────────────────────────────────────────────────┐
│  消息输入框                                                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ @简历筛选Agent 请帮我筛选这批简历...        [发送]       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  说明：                                                       │
│  - 输入 @ 后显示已配置的智能体应用列表                          │
│  - 可同时 @ 多个应用：@简历筛选 @JD生成器 请帮我...             │
│  - 不使用 @ 时，消息由 Manta AI 处理                           │
│  - 也可显式 @Manta AI 来调用通用智能体                          │
└─────────────────────────────────────────────────────────────┘
```

#### 2.4 核心概念图
┌─────────────────────────────────────────────────────────────┐
│                    工作空间 (Workspace)                        │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                    会话列表                           │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │   │
│   │  │   会话 1      │  │   会话 2      │  │   会话 N    │ │   │
│   │  │ ┌──────────┐ │  │ ┌──────────┐ │  │            │ │   │
│   │  │ │ 应用 A   │ │  │ │ 应用 B   │ │  │   ...      │ │   │
│   │  │ │ 应用 B   │ │  │ │ 应用 C   │ │  │            │ │   │
│   │  │ └──────────┘ │  │ └──────────┘ │  │            │ │   │
│   │  └──────────────┘  └──────────────┘  └────────────┘ │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │    对话       │  │    上下文     │  │    记忆       │      │
│   │ Conversations│  │   Context    │  │   Memory     │      │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
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
  workspaceId: string             // 所属工作空间
  title: string                   // 会话标题（从首条消息自动生成）
  agentAppIds: string[]           // 绑定的智能体应用 ID 列表
  messages: ConversationMessage[]
  context: ConversationContext
  status: 'active' | 'archived' | 'deleted'
  createdAt: string
  updatedAt: string
}

interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  agentAppId?: string             // 响应此消息的智能体应用 ID
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
│  工作空间 — 我的工作空间                   [+ 新建会话]    │
├──────────────────────────────────────────────────────────┤
│  ┌── 搜索会话... ──────────────────┐  ┌ 排序 ▼ ─┐        │
│  └─────────────────────────────────┘  └─────────┘        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 💬 筛选前端简历                          2h前       │  │
│  │    应用: 简历筛选 Agent · JD生成器                  │  │
│  │    15 条消息 · 3 次工具调用                          │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 💬 分析候选人背景                          1d前       │  │
│  │    应用: 简历筛选 Agent                            │  │
│  │    8 条消息 · 1 次知识检索                           │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 💬 生成面试问题                            3d前       │  │
│  │    应用: 面试助手                                  │  │
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

#### 6.1 整体布局

Manta 采用侧边栏导航布局：

```
┌─────────────────────────────────────────────────────────────┐
│  Manta                                    [设置] [用户头像]  │
├────────┬────────────────────────────────────────────────────┤
│        │                                                    │
│  会话   │                                                    │
│  ──────│                                                    │
│  工作   │                 内容区域                            │
│  空间   │                                                    │
│  ──────│                                                    │
│  工作流 │                                                    │
│  ──────│                                                    │
│  智能体 │                                                    │
│  应用   │                                                    │
│  ──────│                                                    │
│  知识库 │                                                    │
│        │                                                    │
└────────┴────────────────────────────────────────────────────┘
```

**侧边栏导航说明**：

| 导航项 | 路径 | 功能 |
|--------|------|------|
| **会话** | `/conversations` | 会话列表，新建/管理会话，对话交互 |
| **工作空间** | `/workspace` | 工作空间配置，绑定智能体应用、知识库、工作流，管理工作空间设置 |
| **工作流** | `/workflow` | 工作流管理，创建/编辑/运行工作流 |
| **智能体应用** | `/apps` | 智能体应用管理，创建/编辑/发布应用 |
| **知识库** | `/rag` | 知识库管理，上传文档，配置检索 |

#### 6.2 会话页面 `/conversations`

```
┌─────────────────────────────────────────────────────────────┐
│  会话                                            [+ 新建会话] │
├──────────────┬──────────────────────────────────────────────┤
│  会话列表     │                                              │
│              │   对话区域                                     │
│  [新建会话]   │   ┌─────────────────────────────────────────┐│
│              │   │ 🤖 [Manta AI] 你好！有什么可以帮助你？  ││
│  💬 会话 1    │   │                                         ││
│  💬 会话 2    │   │ 👤 @简历筛选Agent 请帮我筛选这批简历    ││
│  💬 会话 3    │   │                                         ││
│              │   │ 🤖 [简历筛选Agent] 好的，我来帮你筛选...  ││
│              │   │    [调用工具: file_read]                  ││
│              │   │                                         ││
│              │   │ 🤖 [JD生成器] 已根据筛选结果生成面试问题  ││
│              │   │                                         ││
│              │   │ ┌─────────────────────────────────────┐ ││
│              │   │ │ @应用名 输入消息...       [发送]     │ ││
│              │   │ └─────────────────────────────────────┘ ││
│              │   └─────────────────────────────────────────┘│
│              │                                              │
│  ────────────│   当前会话应用                                 │
│  已配置应用   │   🤖 简历筛选Agent                            │
│              │   🤖 JD生成器                                │
│              │   🤖 Manta AI（默认）                          ││
└──────────────┴──────────────────────────────────────────────┘
```

#### 6.3 工作空间配置页面 `/workspace`

```
┌─────────────────────────────────────────────────────────────┐
│  工作空间配置                                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ 基本信息 ──────────────────────────────────────────────┐ │
│  │ 名称: 我的工作空间                                       │ │
│  │ 描述: 日常工作任务管理                                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ 智能体应用配置 ─────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  已配置应用:                                              │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ 🤖 简历筛选Agent              [移除]               │  │ │
│  │  │ 🤖 JD生成器                   [移除]               │  │ │
│  │  │ 🤖 面试助手                   [移除]               │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │  [+ 添加智能体应用]                                       │ │
│  │                                                          │ │
│  │  说明: 配置后可在会话中通过 @应用名 调用                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ 知识库绑定 ─────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  已绑定知识库:                                            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ 📚 简历模板库 (120文档)        [解绑]               │  │ │
│  │  │ 📚 JD模板库 (45文档)           [解绑]               │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │  [+ 绑定知识库]                                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─ 工作流绑定 ─────────────────────────────────────────────┐ │
│  │                                                          │ │
│  │  已绑定工作流:                                            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │ 🔄 简历筛选流程 (5步骤)        [解绑]               │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  │                                                          │ │
│  │  [+ 绑定工作流]                                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                                          [保存]              │
└─────────────────────────────────────────────────────────────┘
```

### 7. API 设计

| 方法 | 路径 | 描述 |
|------|------|------|
| **工作空间** | | |
| `GET` | `/api/workspace` | 获取工作空间配置 |
| `PUT` | `/api/workspace` | 更新工作空间配置 |
| **智能体应用配置** | | |
| `GET` | `/api/workspace/agent-apps` | 获取已配置的智能体应用列表 |
| `POST` | `/api/workspace/agent-apps` | 添加智能体应用到工作空间 |
| `DELETE` | `/api/workspace/agent-apps/:appId` | 从工作空间移除智能体应用 |
| **知识库绑定** | | |
| `GET` | `/api/workspace/knowledge-bases` | 获取已绑定的知识库列表 |
| `POST` | `/api/workspace/knowledge-bases` | 绑定知识库到工作空间 |
| `DELETE` | `/api/workspace/knowledge-bases/:kbId` | 解绑知识库 |
| **工作流绑定** | | |
| `GET` | `/api/workspace/workflows` | 获取已绑定的工作流列表 |
| `POST` | `/api/workspace/workflows` | 绑定工作流到工作空间 |
| `DELETE` | `/api/workspace/workflows/:workflowId` | 解绑工作流 |
| **会话管理** | | |
| `GET` | `/api/conversations` | 获取会话列表 |
| `POST` | `/api/conversations` | 创建新会话 |
| `GET` | `/api/conversations/:convId` | 获取会话详情 |
| `DELETE` | `/api/conversations/:convId` | 删除会话 |
| `POST` | `/api/conversations/:convId/messages` | 发送消息（支持 @调用） |
| `GET` | `/api/conversations/:convId/stream` | SSE 流式响应 |

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

**Workspace** is the top-level runtime environment of the Manta platform, containing multiple conversations. Each conversation supports one or more agent applications to complete tasks through dialogue.

Core concepts:
- Workspace is the user's "workbench", conversations are independent "task dialogues"
- **Manta AI** is the default general agent, handling all basic conversations and tasks
- **Agent Apps** extend Manta AI's capabilities with more powerful features (RAG, workflows, custom system prompts, etc.)
- Each workspace can configure multiple agent apps, invoked via `@app-name` in conversations
- When no agent apps are configured, Manta AI directly handles messages

### 2. Core Concepts

#### 2.1 Manta AI (General Agent)

**Manta AI** is the default general agent of the Manta platform, serving as the foundation for all conversations:
- When no agent apps are configured, all messages are handled by Manta AI
- Manta AI has basic conversation, Q&A, and simple task handling capabilities
- Users can also explicitly invoke it via `@Manta AI` in conversations
- Agent apps extend Manta AI's capabilities with more powerful features

#### 2.2 Agent Apps

**Agent Apps** extend Manta AI's capabilities with more powerful professional features:

| Capability | Manta AI (Basic) | Agent App (Extended) |
|------------|-----------------|---------------------|
| Conversation | ✅ Basic dialogue | ✅ Inherits Manta AI's conversation ability |
| Knowledge Base (RAG) | ❌ | ✅ Bind exclusive knowledge base, enhance domain knowledge |
| Workflow | ❌ | ✅ Define complex task flows, automated execution |
| System Prompt | Generic prompt | ✅ Customized professional domain prompts |
| Tool Capabilities | Basic tools | ✅ Enable professional tools as needed |
| Publish & Share | ❌ | ✅ Can be published as independent app for sharing |

#### 2.3 @Invocation Mechanism

Invoke specific agent apps in conversations using the `@` symbol:
- Type `@` to see a list of configured agent apps
- Can invoke multiple apps simultaneously: `@ResumeScreener @JDGenerator Please help...`
- Messages without `@` are handled by Manta AI
- Can also explicitly `@Manta AI` to invoke the general agent

#### 2.4 Core Concepts

- **Conversations**: Independent task dialogues within a workspace, each binding one or more agent apps
- **Agent Applications**: Execute tasks within conversations, can work individually or collaboratively
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

20 endpoints organized in five groups:

**Workspace Configuration**:
- `GET /api/workspace` - Get workspace configuration
- `PUT /api/workspace` - Update workspace configuration

**Agent App Configuration**:
- `GET /api/workspace/agent-apps` - List configured agent apps
- `POST /api/workspace/agent-apps` - Add agent app to workspace
- `DELETE /api/workspace/agent-apps/:appId` - Remove agent app from workspace

**Knowledge Base Binding**:
- `GET /api/workspace/knowledge-bases` - List bound knowledge bases
- `POST /api/workspace/knowledge-bases` - Bind knowledge base to workspace
- `DELETE /api/workspace/knowledge-bases/:kbId` - Unbind knowledge base

**Workflow Binding**:
- `GET /api/workspace/workflows` - List bound workflows
- `POST /api/workspace/workflows` - Bind workflow to workspace
- `DELETE /api/workspace/workflows/:workflowId` - Unbind workflow

**Conversation Management**:
- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/:convId` - Get conversation details
- `DELETE /api/conversations/:convId` - Delete conversation
- `POST /api/conversations/:convId/messages` - Send message (supports @invocation)
- `GET /api/conversations/:convId/stream` - SSE stream response

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v3.0 | 明确Manta AI为通用智能体，智能体应用以Manta AI为基础拓展能力，新增知识库和工作流绑定 |
| 2026-06-14 | v2.0 | 新增通用智能体概念、@调用机制、侧边栏布局、工作空间配置页面 |
| 2026-06-14 | v1.0 | 初始版本，定义工作空间核心功能 |

---

> 上一篇：[PRD 01 — 系统架构](./01-architecture.md)
> 下一篇：[PRD 03 — 知识库](./03-knowledge-base.md)
