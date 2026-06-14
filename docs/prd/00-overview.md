# PRD 00 — 项目概述与产品愿景 / Project Overview & Product Vision

---

## 中文版

### 1. 产品定位

**Manta** 是一个 **AI Native 智能体应用平台**（AI Native Agent Application Platform）。

核心理念是 **Agent as Application**：每个智能体应用都是一个独立的产品，拥有自己的知识库、工具能力、工作流和运行空间。

与传统 AI 助手的本质区别：

| 维度 | 传统 AI 助手 | Manta 智能体应用 |
|------|------------|-----------------|
| **形态** | 聊天框，用完即弃 | 持久化应用，持续迭代 |
| **知识** | 依赖模型预训练 | 独立 RAG 知识库，可喂养专属领域知识 |
| **能力** | 固定工具集 | 可插拔工具 + 自定义工作流 |
| **运行** | 单次对话 | 独立工作空间，支持记忆和上下文 |
| **质量** | 靠感觉用 | RAGAs + Agent 双维度评估 |
| **可观测** | 黑盒 | 全链路日志、会话回放 |

### 2. 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                    Manta 核心概念模型                          │
│                                                              │
│   ┌──────────────┐                                           │
│   │   工作空间     │  ← 顶层运行环境：包含多个会话              │
│   │  Workspace    │                                          │
│   └──────┬───────┘                                           │
│          │                                                   │
│          │ 包含多个                                           │
│          ▼                                                   │
│   ┌──────────────┐                                           │
│   │     会话      │  ← 独立任务对话：支持多个智能体应用          │
│   │ Conversation  │                                          │
│   └──────┬───────┘                                           │
│          │                                                   │
│          │ 使用一个或多个                                      │
│          ▼                                                   │
│   ┌──────────────┐                                           │
│   │  智能体应用    │  ← 产品形态：以Manta AI为基础，拓展能力     │
│   │  Agent App    │                                          │
│   └──────┬───────┘                                           │
│          │                                                   │
│          │ 基于                                               │
│          ▼                                                   │
│   ┌──────────────┐                                           │
│   │   Manta AI    │  ← 通用智能体：默认AI助手，基础对话能力     │
│   │               │                                          │
│   └──────┬───────┘                                           │
│          │                                                   │
│          │ 使用                                               │
│          ▼                                                   │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │   知识库      │  │    工作流     │  │    工具       │      │
│   │  Knowledge   │  │  Workflow    │  │   Tools      │      │
│   │   Base       │  │              │  │              │      │
│   └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              评估系统（全局覆盖）                       │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**核心概念说明**：

| 概念 | 定义 | 说明 |
|------|------|------|
| **工作空间 (Workspace)** | 顶层运行环境 | 包含多个会话，是用户的"工作台"，可配置智能体应用、知识库、工作流 |
| **会话 (Conversation)** | 独立任务对话 | 支持一个或多个智能体应用进行对话完成任务 |
| **Manta AI** | 通用智能体 | 默认AI助手，负责基础对话和任务，是智能体应用的基础 |
| **智能体应用 (Agent App)** | 产品形态 | 以Manta AI为基础，绑定知识库、工具、工作流、定制提示词，可在会话中通过@调用 |
| **知识库 (Knowledge Base)** | 数据源 | RAG 文档处理，支持多后端向量数据库 |
| **工作流 (Workflow)** | 任务编排 | 独立可重用的任务流，支持串行/并行/条件/循环 |
| **工具 (Tools)** | 能力扩展 | 内置工具 + MCP 工具，可插拔 |
| **评估 (Evaluation)** | 质量保障 | RAGAs 7 维度 + Agent 6 维度评估 |

### 3. 产品边界

**包含**：
- 智能体应用管理（创建、编辑、删除、发布）
- 应用搭建器（Agent 配置、工具选择、RAG 绑定、工作流绑定）
- 工作空间（独立对话、上下文管理、记忆系统）
- RAG 知识库引擎（多后端：SQLite-vec、Milvus、Chroma、BM25）
- 工作流引擎（串行/并行/条件/循环，支持 human-in-the-loop）
- 评估流水线（RAG 评估 + Agent 评估）

**不包含（v1）**：
- 多租户 SaaS 化部署（v1 仅本地单用户）
- 应用市场/模板商店（未来版本）
- 应用付费/计费系统
- 移动端原生 App
- 复杂的多 Agent 编排系统（用工作流 + 智能体应用组合实现）

### 4. 目标用户画像

| 角色 | 描述 | 核心诉求 |
|------|------|---------|
| **应用搭建者** | 非技术业务专家、PM、运营 | 无需编码，通过页面配置搭建智能体应用 |
| **知识管理者** | 领域专家、文档维护者 | 上传/管理知识库文档，可视化处理知识数据 |
| **Agent 开发者** | 技术型用户、AI 工程师 | 自定义 Agent 逻辑、接入外部工具、调试评估 |
| **应用使用者** | 终端用户 | 在工作空间内与 Agent 对话，完成业务任务 |

### 5. 使用场景

**场景 1：简单对话应用**
- 创建智能体应用 → 配置 Agent → 发布 → 在工作空间对话

**场景 2：知识增强应用**
- 创建知识库 → 上传文档 → 创建应用 → 绑定知识库 → 发布

**场景 3：自动化工作流**
- 创建工作流（定义步骤）→ 创建应用 → 绑定工作流 → 定时触发

**场景 4：全功能应用**
- 创建知识库 → 创建工作流 → 创建应用 → 绑定知识库+工作流+工具 → 评估质量 → 发布

### 6. 技术栈

| 层级 | 技术选型 |
|------|---------|
| **前端框架** | Next.js 15 + React 19 + TypeScript |
| **样式** | Tailwind CSS + CSS 变量（65 套主题） |
| **状态管理** | Zustand |
| **图标** | lucide-react |
| **后端** | Next.js Route Handlers (API Routes) |
| **存储** | 文件系统 (JSON) + SQLite-vec + 可选云向量库 |
| **LLM** | OpenAI / Anthropic / Ollama（本地） |

### 7. 产品命名

- **产品名**：Manta
- **Tagline**：「Agent as Application — 每个 Agent 都是一个产品」
- **核心概念**：智能体应用 (Agent App) = 知识库 + 工具 + 工作流 + 工作空间

---

## English Version

### 1. Product Positioning

**Manta** is an **AI Native Agent Application Platform**.

The core philosophy is **Agent as Application**: each agent app is an independent product with its own knowledge base, tools, workflow, and workspace.

### 2. Core Concepts

| Concept | Definition | Description |
|---------|------------|-------------|
| **Workspace** | Top-level runtime | Contains multiple conversations, user's "workbench", can configure agent apps, knowledge bases, workflows |
| **Conversation** | Independent task dialogue | Supports one or more agent apps to complete tasks |
| **Manta AI** | General agent | Default AI assistant, handles basic conversations and tasks, foundation for agent apps |
| **Agent App** | Product form | Extends Manta AI capabilities with knowledge base, tools, workflow, custom prompts; invoked via @ in conversations |
| **Knowledge Base** | Data source | RAG document processing, multi-backend vector DB |
| **Workflow** | Task orchestration | Independent reusable task flows |
| **Tools** | Capability extension | Built-in + MCP tools, pluggable |
| **Evaluation** | Quality assurance | RAGAs 7-dim + Agent 6-dim evaluation |

### 3. Product Scope

**In Scope**: Agent app management, app builder, workspace, RAG knowledge engine, workflow engine, evaluation pipeline.

**Out of Scope (v1)**: Multi-tenant SaaS, app marketplace, billing, mobile apps, complex multi-agent orchestration.

### 4. Target Personas

| Role | Description | Core Needs |
|------|-------------|------------|
| **App Builder** | Non-technical experts, PMs | Build agent apps via UI, no coding |
| **Knowledge Manager** | Domain experts | Upload/manage KB documents |
| **Agent Developer** | AI engineers | Customize agent logic, integrate tools |
| **App End User** | End users | Chat with agents in workspace |

### 5. Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript
- **Styling**: Tailwind CSS + CSS variables (65 themes)
- **State**: Zustand
- **Backend**: Next.js Route Handlers
- **Storage**: File system (JSON) + SQLite-vec + optional cloud vector DB
- **LLM**: OpenAI / Anthropic / Ollama (local)

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v4.0 | 新增Manta AI概念，明确智能体应用以Manta AI为基础拓展能力 |
| 2026-06-14 | v3.0 | 重新组织：明确核心概念（智能体应用、工作空间、知识库、工作流），移除过度设计 |
| 2026-06-12 | v2.0 | 产品定位升级：从 Agent Operating System 升级为 AI Native Agent Application Platform |
| 2026-06-12 | v1.0 | 初始版本 |

---

> 下一篇：[PRD 01 — 系统架构](./01-architecture.md)
