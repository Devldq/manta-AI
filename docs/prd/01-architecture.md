# PRD 01 — 系统架构 / System Architecture

---

## 中文版

### 1. 架构总览

Manta 采用分层架构，从上到下分为：UI 层 → API 层 → 应用层 → 引擎层 → 存储层。

```
┌──────────────────────────────────────────────────────────────────────┐
│                        UI 层 (Next.js App Router)                      │
│  ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  聊天页   │ │ 应用管理 │ │ 知识库   │ │ 工作流  │ │  评估中心   │  │
│  │ /tasks   │ │ /apps   │ │ /rag     │ │/workflow│ │/evaluation  │  │
│  └──────────┘ └─────────┘ └──────────┘ └─────────┘ └─────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                       API 层 (REST + SSE)                             │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐   │
│  │/api/apps │ │/api/rag  │ │/api/work- │ │/api/chat│ │/api/eval│   │
│  │          │ │          │ │  flow     │ │         │ │         │   │
│  └──────────┘ └──────────┘ └───────────┘ └─────────┘ └─────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                      应用层 / Application Layer                        │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │
│  │ AppManager    │ │ AppBuilder    │ │ Workspace                 │   │
│  │ 应用CRUD管理   │ │ 应用搭建引擎   │ │ 工作空间（对话/记忆/上下文）│   │
│  └───────────────┘ └───────────────┘ └───────────────────────────┘   │
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

### 2. 核心模块详解

#### 2.1 应用层（Application Layer）

**AppManager**：应用生命周期管理
- 创建/编辑/删除/复制应用
- 应用元数据管理（名称、描述、图标、标签）
- 应用状态管理（草稿、已发布、已归档）

**AppBuilder**：应用搭建引擎
- Agent 选择与配置（从注册表选择已有 Agent + 微调参数）
- 知识库绑定（关联 RAG 知识库）
- 工作流绑定（关联工作流定义）
- 工具选择（从工具注册表选择可用工具）
- System Prompt 定制

**Workspace**：工作空间
- 独立对话历史（每个应用独立的会话列表）
- 上下文管理（当前对话上下文、工作目录）
- 记忆系统（短期记忆 + 长期记忆）

#### 2.2 引擎层（Engine Layer）

**Agent Loop**：智能体执行循环（已有）
- LLM 调用、工具执行、上下文管理

**Workflow Engine**：工作流引擎
- 工作流定义解析
- 步骤执行（串行/并行/条件/循环）
- 人工审核节点（human-in-the-loop）
- 执行状态追踪

**RAG Engine**：知识库引擎
- 文档处理流水线（解析→分块→向量化）
- 多后端支持（SQLite-vec、Milvus、Chroma、BM25）
- 混合检索（向量 + 关键词）

**Eval Engine**：评估引擎
- RAGAs 7 维度评估
- Agent 6 维度评估
- 评估报告生成

**Memory System**：记忆系统
- 短期记忆（对话上下文）
- 长期记忆（跨对话知识）

#### 2.3 存储层（Storage Layer）

```
~/.manta-data/
├── apps/                        # 应用数据根目录
│   └── {app-id}/                # 单个应用空间
│       ├── app.json             # 应用配置
│       ├── conversations/       # 对话数据
│       │   └── {conv-id}.json
│       ├── knowledge/           # 知识库数据
│       │   ├── kb.json
│       │   ├── documents/
│       │   └── index/
│       ├── workflows/           # 工作流数据
│       │   └── {workflow-id}.json
│       ├── memory/              # 记忆数据
│       │   ├── short-term.json
│       │   └── long-term.json
│       ├── evaluations/         # 评估结果
│       └── logs/                # 应用级日志
├── rag/                         # 共享 RAG 配置
│   └── providers.json
└── ...                          # 现有数据保持不变
```

### 3. 核心类型映射

现有 `src/core/types.ts` 已定义的核心类型：

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

### 4. 前后端交互模式

```
┌─────────────────────────────────────────────────────┐
│                    前端 (Next.js)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ 页面组件      │  │ Zustand Store│  │ API Client │  │
│  │ (React RSC)  │  │ (状态管理)   │  │ (fetch包装) │  │
│  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                  │                 │         │
│         └──────────────────┴─────────────────┘         │
│                            │                           │
└────────────────────────────┼───────────────────────────┘
                             │
                    REST / SSE
                             │
┌────────────────────────────┼───────────────────────────┐
│                后端 API Route Handlers                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ /api/apps/*     → AppManager (应用CRUD)           │  │
│  │ /api/rag/*      → RAG Engine (知识库操作)          │  │
│  │ /api/workflow/* → Workflow Engine (工作流操作)      │  │
│  │ /api/eval/*     → Eval Engine (评估执行)           │  │
│  │ /api/chat/*     → Agent Loop (聊天，已有)          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 5. 技术约束

- **兼容性**：不影响现有 `/tasks`、`/mcp`、`/settings` 页面的功能
- **渐进增强**：现有 Agent 运行能力保持不变，应用层是上层封装
- **本地优先**：v1 阶段所有数据存储在本地，不依赖云服务
- **Electron 兼容**：所有功能在 Electron 桌面端同样可用
- **性能目标**：应用列表页首屏加载 < 1s（≤50 个应用时）

---

## English Version

### 1. Architecture Overview

Manta uses a layered architecture: UI Layer → API Layer → Application Layer → Engine Layer → Storage Layer.

### 2. Core Modules

**Application Layer**: AppManager (CRUD), AppBuilder (configuration), Workspace (dialogue/context/memory)

**Engine Layer**: Agent Loop (existing), Workflow Engine, RAG Engine, Eval Engine, Memory System

**Storage Layer**: Per-app isolated data directories under `~/.manta-data/apps/{app-id}/`

### 3. Core Type Mapping

Existing `src/core/types.ts` defines: Task, WorkflowDef, WorkflowStep, WorkflowExecution, AgentEntry, AppConfig, RagBinding, Automation.

### 4. Tech Constraints

- Backward compatible with existing pages
- Progressive enhancement over existing Agent capabilities
- Local-first for v1
- Electron compatible
- App list first paint < 1s

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v2.0 | 重新组织：明确分层架构，映射现有类型，移除 Pipeline 重复概念 |
| 2026-06-12 | v1.0 | 初始版本 |

---

> 上一篇：[PRD 00 — 项目概述](./00-overview.md)
> 下一篇：[PRD 02 — 工作空间](./02-workspace.md)
