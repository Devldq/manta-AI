# PRD 00 — 项目概述与产品愿景 / Project Overview & Product Vision

---

## 中文版

### 1. 产品定位

**Manta** 是一个 **AI Native 智能体应用平台**（AI Native Agent Application Platform）。

它不是一个 Agent 运行器，不是一个 RAG 框架，也不是一个评测工具——它是一个让 Agent 从「一次对话」升级为「一个产品」的完整平台。核心理念是 **Agent as Application**：每个 Agent 都拥有独立的知识体系、工具能力、质量标准和发布通道——而这一切都是按需启用、自由组合的。

和传统 AI 助手的本质区别：

| 维度 | 传统 AI 助手 | Manta 智能体应用 |
|------|------------|-----------------|
| **形态** | 聊天框，用完即弃 | 持久化应用，持续迭代 |
| **知识** | 依赖模型预训练 | 独立 RAG 知识库，可喂养专属领域知识 |
| **能力** | 固定工具集 | 可插拔 MCP 工具 + 自定义 Agent 配置 |
| **质量** | 靠感觉用 | RAGAs + Agent 双维度评估流水线 |
| **上线** | 手动操作 | 定时任务、Webhook 触发、一键发布 |
| **可观测** | 黑盒 | 全链路日志、会话回放、上下文快照 |

### 2. 核心价值主张

Manta 提供四大能力模块，**没有固定顺序，可独立使用、自由组合**：

```
 ┌──────────────────────────────────────────────────────────┐
 │               Manta 能力矩阵                              │
 │                                                           │
 │  ┌──────────────┐  ┌──────────────┐                       │
 │  │  应用搭建器   │  │  RAG 知识库  │                       │
 │  │              │  │              │                       │
 │  │ · Agent 绑定 │  │ · 文档上传   │                       │
 │  │ · 工具配置   │  │ · 智能分块   │                       │
 │  │ · Prompt 调优│  │ · 向量化     │                       │
 │  │ · 自动化编排 │  │ · 混合检索   │                       │
 │  └──────┬───────┘  └──────┬───────┘                       │
 │         │                 │                               │
 │         │    自由组合     │                               │
 │         │                 │                               │
 │  ┌──────┴───────┐  ┌──────┴───────┐                       │
 │  │  评估流水线   │  │  自动化发布   │                       │
 │  │              │  │              │                       │
 │  │ · RAGAs 7 维 │  │ · 定时任务   │                       │
 │  │ · Agent 评估 │  │ · Webhook    │                       │
 │  │ · 数据集管理 │  │ · 状态管理   │                       │
 │  │ · 对比实验   │  │ · 版本控制   │                       │
 │  └──────────────┘  └──────────────┘                       │
 │                                                           │
 │  ┌────────────────────────────────────────────────────┐  │
 │  │              可观测性引擎（全局覆盖）                │  │
 │  └────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────┘
```

**使用场景举例**：

- 只建一个知识库，不绑定任何应用 → 用 RAG 知识库
- 已有 Agent，只想跑评估 → 用评估流水线
- 搭一个简单应用，不需要 RAG → 用应用搭建器 + 自动化发布
- 全套餐：搭建应用 → 绑定知识库 → 评估质量 → 定时上线

四种能力全部内置在可观测性引擎之上——无论怎么组合，都能看清 Agent 每一步在做什么、为什么这么做。

### 3. 目标用户画像

| 角色 | 描述 | 核心诉求 |
|------|------|---------|
| **应用搭建者** | 非技术业务专家、PM、运营 | 无需编码，通过页面配置搭建智能体应用 |
| **知识管理者** | 领域专家、文档维护者 | 上传/管理知识库文档，可视化处理知识数据 |
| **Agent 开发者** | 技术型用户、AI 工程师 | 自定义 Agent 逻辑、接入外部工具、调试评估 |
| **应用使用者** | 终端用户 | 在应用空间内与 Agent 对话，完成业务任务 |

### 4. 产品边界

**包含**：
- 应用 CRUD 管理（创建、编辑、删除、复制应用）
- 应用搭建器（Agent 配置、工具选择、RAG 绑定、自动化任务）
- RAG 知识库引擎（多后端：SQLite、Milvus、Chrome、BM25 混合检索）
- 可视化文档处理流水线（上传 → 解析 → 分块 → 向量化）
- 评估流水线（RAG 评估 + Agent 评估）
- 应用独立工作空间（对话、知识库管理、工具配置）

**不包含**：
- 多租户 SaaS 化部署（v1 仅本地单用户）
- 应用市场/模板商店（未来版本）
- 应用付费/计费系统
- 移动端原生 App

### 5. 产品命名

- **产品名**：Manta（不变）
- **新 Tagline**：「Agent as Application — 按需组合，不设流程」
- **应用概念**：用户搭建的 Agent 实例，拥有独立空间、知识库、工具和发布通道，四大能力模块按需启用

---

## English Version

### 1. Product Positioning

**Manta** is an **AI Native Agent Application Platform**.

It's not an agent runner, not a RAG framework, not an evaluation tool — it's a complete platform that upgrades an Agent from "a conversation" to "a product". The core philosophy is **Agent as Application**: each agent owns its independent knowledge system, tool capabilities, quality standards, and release channels — all modular, opt-in, and freely combinable.

Key differences from traditional AI assistants:

| Dimension | Traditional AI Assistant | Manta Agent Application |
|-----------|------------------------|------------------------|
| **Form** | Chat box, disposable | Persistent app, iterated continuously |
| **Knowledge** | Relies on model pretraining | Independent RAG KB, feedable with domain knowledge |
| **Capabilities** | Fixed toolset | Pluggable MCP tools + custom Agent config |
| **Quality** | Subjective feel | RAGAs + Agent dual-dimension evaluation pipeline |
| **Deployment** | Manual operation | Cron jobs, Webhook triggers, one-click publish |
| **Observability** | Black box | Full-chain logs, session replay, context snapshots |

### 2. Core Value Proposition

Manta offers four capability modules — **no fixed order, use independently or combine freely**:

```
 ┌──────────────────────────────────────────────────────────┐
 │               Manta Capability Matrix                     │
 │                                                           │
 │  ┌──────────────┐  ┌──────────────┐                       │
 │  │ App Builder  │  │   RAG KB     │                       │
 │  │              │  │              │                       │
 │  │ · Agent bind │  │ · Doc upload │                       │
 │  │ · Tool config│  │ · Chunking   │                       │
 │  │ · Prompt tune│  │ · Vectorize  │                       │
 │  │ · Automation │  │ · Hybrid srch│                       │
 │  └──────┬───────┘  └──────┬───────┘                       │
 │         │                 │                               │
 │         │  combine freely │                               │
 │         │                 │                               │
 │  ┌──────┴───────┐  ┌──────┴───────┐                       │
 │  │ Eval Pipeline│  │  Auto Deploy │                       │
 │  │              │  │              │                       │
 │  │ · RAGAs 7D   │  │ · Cron jobs  │                       │
 │  │ · Agent eval │  │ · Webhooks   │                       │
 │  │ · Datasets   │  │ · Status mgmt│                       │
 │  │ · A/B compare│  │ · Versioning │                       │
 │  └──────────────┘  └──────────────┘                       │
 │                                                           │
 │  ┌────────────────────────────────────────────────────┐  │
 │  │          Observability Engine (global coverage)     │  │
 │  └────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────┘
```

**Usage examples**:

- Just build a knowledge base, no app needed → use RAG KB
- Already have an agent, just want to evaluate → use Eval Pipeline
- Build a simple app without RAG → use App Builder + Auto Deploy
- Full combo: build app → bind KB → evaluate quality → schedule release

All four modules sit on top of the observability engine — no matter how you combine them, you always see what your agent is doing at every step, and why.

### 3. Target Personas

| Role | Description | Core Needs |
|------|-------------|------------|
| **App Builder** | Non-technical business experts, PMs, operations | Build agent apps via UI configuration, no coding required |
| **Knowledge Manager** | Domain experts, documentation maintainers | Upload/manage KB documents, visually process knowledge data |
| **Agent Developer** | Technical users, AI engineers | Customize agent logic, integrate external tools, debug & evaluate |
| **App End User** | End users | Chat with agents in app workspace, complete business tasks |

### 4. Product Scope

**In Scope**:
- App CRUD management (create, edit, delete, clone apps)
- App Builder (Agent config, tool selection, RAG binding, automation tasks)
- RAG knowledge engine (multi-backend: SQLite, Milvus, Chroma, BM25 hybrid)
- Visual document processing pipeline (upload → parse → chunk → vectorize)
- Evaluation pipeline (RAG evaluation + Agent evaluation)
- Independent app workspace (chat history, KB management, tool config)

**Out of Scope (v1)**:
- Multi-tenant SaaS deployment (local single-user only for v1)
- App marketplace / template store (future versions)
- App payment / billing system
- Native mobile apps

### 5. Product Naming

- **Product Name**: Manta (unchanged)
- **New Tagline**: "Agent as Application — modular, not a pipeline"
- **App Concept**: User-built agent instance with independent workspace, knowledge base, tools, and release channels — four capability modules that can be opted in freely

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-12 | v2.0 | 产品定位升级：从 Agent Operating System 升级为 AI Native Agent Application Platform |
| 2026-06-12 | v1.0 | 初始版本 |

---

> 下一篇：[PRD 01 — 系统架构](./01-architecture.md)
