# PRD 01 — 系统架构 / System Architecture

---

## 中文版

### 1. 架构总览

升级后的 Manta 在现有三层架构（UI 层 → 引擎层 → 插件层）基础上，新增**应用层**和**知识层**：

```
┌──────────────────────────────────────────────────────────────────────┐
│                        UI 层 (Next.js App Router)                      │
│  ┌──────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌─────────────┐  │
│  │  聊天页   │ │ 应用管理 │ │ 应用搭建器 │ │ 知识库  │ │  评估中心   │  │
│  │ /tasks   │ │ /apps   │ │/apps/[id]│ │/rag     │ │/evaluation  │  │
│  │ (已有)   │ │ (升级)  │ │  /builder │ │ (新增)  │ │  (新增)    │  │
│  └──────────┘ └─────────┘ └──────────┘ └─────────┘ └─────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                       API 层 (REST + SSE + WebSocket)                 │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐   │
│  │/api/apps │ │/api/rag  │ │/api/eval  │ │/api/chat│ │/api/... │   │
│  │  (新增)  │ │  (新增)   │ │  (新增)   │ │ (已有)  │ │ (已有)  │   │
│  └──────────┘ └──────────┘ └───────────┘ └─────────┘ └─────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                      应用层 / Application Layer (新增)                │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │
│  │ AppManager    │ │ AppBuilder    │ │ AppWorkspace              │   │
│  │ 应用CRUD管理   │ │ 应用搭建引擎   │ │ 应用运行空间(对话/知识库)  │   │
│  └───────────────┘ └───────────────┘ └───────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                      知识层 / Knowledge Layer (新增)                   │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐   │
│  │ DocumentPipeline │ │ IRagProvider     │ │ KnowledgeManager   │   │
│  │ 文档处理流水线    │ │ RAG抽象接口       │ │ 知识库生命周期管理  │   │
│  │ parse→chunk→embed│ │ (多后端实现)      │ │                    │   │
│  └──────────────────┘ └──────────────────┘ └────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                    评估层 / Evaluation Layer (新增)                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐   │
│  │ EvalPipeline     │ │ RAGAsAdapter     │ │EvalReportGenerator │   │
│  │ 评估流水线引擎    │ │ RAGAs框架适配     │ │ 评估报告生成        │   │
│  └──────────────────┘ └──────────────────┘ └────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                 引擎层 / Engine Layer (已有，升级)                      │
│  ┌──────────┐ ┌──────┐ ┌──────────┐ ┌───────────────┐ ┌─────────┐  │
│  │Agent Loop│ │ LLM  │ │ Context  │ │ Observability │ │ Tools   │  │
│  │ (已有)   │ │(已有)│ │ (已有)   │ │ (已有)        │ │ (已有)  │  │
│  └──────────┘ └──────┘ └──────────┘ └───────────────┘ └─────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│               存储层 / Storage Layer (已有，扩展)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │
│  │ DataStore│ │ ~/.manta │ │ ~/.manta │ │ ~/.manta-data/apps/    │  │
│  │ (已有)   │ │ -data/   │ │ -data/   │ │ {app-id}/              │  │
│  │          │ │ (已有)   │ │ rag/     │ │ 独立应用数据目录 (新增)  │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. 核心新增模块详解

#### 2.1 应用层（Application Layer）

**AppManager**：应用生命周期管理
- 创建/编辑/删除/复制应用
- 应用元数据管理（名称、描述、图标、标签）
- 应用状态管理（草稿、已发布、已归档）
- 应用配置持久化（JSON/YAML）

**AppBuilder**：应用搭建引擎
- Agent 选择与配置（从注册表选择已有 Agent + 微调参数）
- 知识库绑定（关联 RAG 知识库）
- 工具选择（从工具注册表选择可用工具）
- 自动化任务（定时触发、Webhook 触发）
- System Prompt 定制
- 输出格式定义

**AppWorkspace**：应用运行空间
- 独立对话历史（每个应用独立的会话列表）
- 知识库管理入口
- 工具使用记录
- 应用级设置

#### 2.2 知识层（Knowledge Layer）

**DocumentPipeline**：文档处理流水线
```
上传 → 格式检测 → 文本提取 → 智能分块 → 向量化 → 索引入库
  │        │          │          │          │          │
  │   自动识别    PDF/DOCX   滑动窗口    Embedding   写入向量
  │   文件类型    /MD/TXT   语义分块    Model选择   数据库
```

**IRagProvider**：可插拔 RAG 接口
```typescript
interface IRagProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  
  // 生命周期
  initialize(config: RagConfig): Promise<void>;
  destroy(): Promise<void>;
  
  // 文档操作
  indexDocument(doc: ProcessedDocument): Promise<IndexResult>;
  indexBatch(docs: ProcessedDocument[]): Promise<IndexResult[]>;
  deleteDocument(docId: string): Promise<void>;
  
  // 检索
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  hybridSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>;
  
  // 健康检查与统计
  healthCheck(): Promise<HealthStatus>;
  getStats(): Promise<RagStats>;
}
```

**计划支持的 RAG Provider**：

| Provider | 引擎 | 特点 | 适用场景 |
|----------|------|------|---------|
| SQLiteVecProvider | sqlite-vec | 零配置本地向量库 | 小规模个人知识库 |
| MilvusProvider | Milvus | 分布式高性能向量库 | 大规模企业知识库 |
| ChromaProvider | ChromaDB | 开源嵌入式向量库 | 中型知识库 |
| BM25Provider | SQLite + BM25 | 关键词检索 | 混合检索补充 |
| LLMCompilerProvider | LLM 编译 | LLM 编译进知识库 | 结构化知识 |

#### 2.3 评估层（Evaluation Layer）

详见 [PRD 05 — 评估流水线](./05-evaluation.md)

#### 2.4 存储层扩展

现有存储 `~/.manta-data/` 基础上，新增：

```
~/.manta-data/
├── apps/                        # 新增：应用数据根目录
│   └── {app-id}/                # 单个应用空间
│       ├── app.json             # 应用配置
│       ├── conversations/       # 对话数据
│       │   └── {conv-id}.json
│       ├── rag/                 # RAG 知识库数据
│       │   ├── documents/       # 原始文档
│       │   └── index/           # 向量索引
│       ├── evaluations/         # 评估结果
│       │   └── {eval-id}.json
│       └── logs/                # 应用级日志
├── rag/                         # 共享 RAG 配置
│   └── providers.json           # Provider 配置
└── ...                          # 现有数据保持不变
```

### 3. 前后端交互模式

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
                    REST / SSE / WebSocket
                             │
┌────────────────────────────┼───────────────────────────┐
│                后端 API Route Handlers                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │ /api/apps/*     → AppManager (应用CRUD)           │  │
│  │ /api/rag/*      → KnowledgeManager (知识库操作)    │  │
│  │ /api/eval/*     → EvalPipeline (评估执行)         │  │
│  │ /api/chat/*     → AgentLoop (聊天，已有)          │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 4. 技术约束

- **兼容性**：不影响现有 `/tasks`、`/mcp`、`/settings` 页面的功能
- **渐进增强**：现有 Agent 运行能力保持不变，应用层是上层封装
- **本地优先**：v1 阶段所有数据存储在本地，不依赖云服务
- **Electron 兼容**：所有功能在 Electron 桌面端同样可用
- **性能目标**：应用列表页首屏加载 < 1s（≤50 个应用时）

---

## English Version

### 1. Architecture Overview

The upgraded Manta adds **Application Layer** and **Knowledge Layer** on top of the existing three-layer architecture (UI → Engine → Plugin):

```
┌──────────────────────────────────────────────────────────────────────┐
│                      UI Layer (Next.js App Router)                     │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐  │
│  │  Chat    │ │ App Mgmt │ │App Builder│ │Knowledge │ │Evaluation│  │
│  │ (existing)│ │(upgraded)│ │  (new)    │ │  (new)   │ │  (new)   │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────┘ └──────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                     API Layer (REST + SSE + WebSocket)                 │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────┐  │
│  │/api/apps │ │/api/rag  │ │/api/eval  │ │/api/chat │ │/api/...  │  │
│  │  (new)   │ │  (new)   │ │  (new)    │ │(existing)│ │(existing) │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────┘ └──────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│                   Application Layer (New)                              │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐   │
│  │ AppManager    │ │ AppBuilder    │ │ AppWorkspace              │   │
│  │ App CRUD      │ │ Build Engine  │ │ Runtime space per app     │   │
│  └───────────────┘ └───────────────┘ └───────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                    Knowledge Layer (New)                               │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐   │
│  │ DocumentPipeline │ │ IRagProvider     │ │ KnowledgeManager   │   │
│  │ parse→chunk→embed│ │ Pluggable RAG    │ │ KB lifecycle       │   │
│  └──────────────────┘ └──────────────────┘ └────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│                   Evaluation Layer (New)                               │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐   │
│  │ EvalPipeline     │ │ RAGAsAdapter     │ │EvalReportGenerator │   │
│  └──────────────────┘ └──────────────────┘ └────────────────────┘   │
├──────────────────────────────────────────────────────────────────────┤
│              Engine Layer (Existing, to be upgraded)                   │
│  ┌──────────┐ ┌──────┐ ┌──────────┐ ┌───────────────┐ ┌─────────┐  │
│  │Agent Loop│ │ LLM  │ │ Context  │ │ Observability │ │ Tools   │  │
│  └──────────┘ └──────┘ └──────────┘ └───────────────┘ └─────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│             Storage Layer (Existing, to be extended)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │
│  │DataStore │ │~/.manta  │ │~/.manta  │ │~/.manta-data/apps/     │  │
│  │(existing)│ │-data/    │ │-data/rag/│ │{app-id}/ (new)         │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 2. Key New Modules

#### 2.1 Application Layer

- **AppManager**: Lifecycle management (CRUD, metadata, states: draft/published/archived)
- **AppBuilder**: Agent configurator (agent selection, KB binding, tool selection, automation tasks, system prompt customization)
- **AppWorkspace**: Per-app runtime space (isolated conversation history, KB management, tool usage records)

#### 2.2 Knowledge Layer

**DocumentPipeline**: Upload → Format Detection → Text Extraction → Smart Chunking → Vectorization → Indexing

**IRagProvider**: Pluggable interface supporting SQLite-vec, Milvus, ChromaDB, BM25, and LLM-compiled knowledge bases.

#### 2.3 Evaluation Layer

See [PRD 05 — Evaluation Pipeline](./05-evaluation.md)

#### 2.4 Storage Extension

New per-app data directories under `~/.manta-data/apps/{app-id}/` with isolated conversations, RAG index, evaluations, and logs.

### 3. Tech Constraints

- **Compatibility**: Existing pages (`/tasks`, `/mcp`, `/settings`) remain unaffected
- **Progressive Enhancement**: Existing agent capabilities unchanged; app layer is an upper abstraction
- **Local First**: v1 stores all data locally without cloud dependency
- **Electron Compatible**: All features work in Electron desktop
- **Performance**: App list first paint < 1s (≤ 50 apps)

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-12 | v1.0 | 初始版本 |

---

> 上一篇：[PRD 00 — 项目概述](./00-overview.md)
> 下一篇：[PRD 02 — 应用管理](./02-app-management.md)
