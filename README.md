# Manta · Agent 调度操作系统

> Humans steer. Agents execute. Drivers are pluggable.

多 Agent 协作调度操作系统，基于 Next.js 15 + React 19 + TypeScript 全栈实现，支持工作流编排、MCP 工具集成和 Electron 桌面端。

## 核心特性

- **多 Agent 调度** — 轻量模式（直接指定 Agent）和完整模式（工作流编排），任务全生命周期状态机管理
- **工作流引擎** — YAML 定义工作流，支持 sequential / parallel / human_in_loop / conditional / loop，可视化编辑器（流程图 / YAML 双模式）
- **MCP 协议支持** — 完整的 Model Context Protocol 实现，支持 local（stdio）和 remote（HTTP + OAuth）MCP 服务器，工具可见性控制
- **AI 聊天** — 内置 LLM 聊天，Agent Loop 真流式输出，循环检测与自动中断
- **工具系统** — Claude Code 风格工具集（Bash / Read / Write / Edit / Glob / Grep / WebFetch / WebSearch / Todo），MCP 工具集成，延迟加载与智能搜索
- **插件系统** — 可插拔的 Runner / Agent 架构，当前支持 OpenClaw，可通过 npm 安装新插件
- **60+ 设计主题** — 从 Apple、Linear、Notion、Vercel、Stripe 等知名产品设计规范提取，亮暗模式，自定义微调
- **文件安全** — CWD 内自由访问，CWD 外需用户实时授权
- **通知系统** — macOS 系统通知 + Webhook（飞书 / Slack / 钉钉 / Discord）
- **AI 润色** — 内置 AI 助手帮助创建 / 优化 Agent SOUL.md，零配置使用 OpenClaw
- **桌面应用** — Electron 打包，自动更新（GitHub Releases）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（Next.js + Electron）
npm run dev

# 仅启动 Web 端
npm run dev:next
```

访问 http://localhost:3000

## 功能页面

| 页面 | 路径 | 说明 |
|------|------|------|
| Dashboard | `/` | 任务统计、工作流概况、快速操作入口 |
| 任务看板 | `/kanban` | 看板视图，拖拽状态流转，处理中心 |
| AI 聊天 | `/tasks` | 流式聊天，Agent 选择，工具调用展示，Markdown 渲染 |
| 工作流编排 | `/workflows` | 可视化编辑器（流程图 / YAML），执行状态监控 |
| Agent 管理 | `/agents` | 内置 Agent CRUD + 外部 Agent（OpenClaw 插件扫描），AI 润色 SOUL.md |
| Skills 技能库 | `/skills` | CodeFlicker Skills，分类筛选，搜索 |
| MCP Server | `/mcp` | MCP 服务器管理（stdio / HTTP / OAuth），工具可见性控制 |
| 设置 | `/settings` | Runner 探测、Webhook 通知、插件管理、自动更新 |

## 工作流

| 工作流 | ID | 说明 |
|--------|------|------|
| 需求开发流 | `dev-standard` | 需求 → 架构方案 → 人工审批 → 开发 → QA + Review 并行 |
| 快速修复流 | `quick-fix` | 直接开发 → 代码审查（适用于 hotfix） |
| 前端需求全流程 | `plateco-frontend-dev` | 14 阶段完整流程：环境准备 → 需求 → 技术方案 → 审批 → 开发 → 部署 → 提测 → 影响面分析 → 发布 → 变更报告 |

## LLM 支持

| 提供商 | 说明 |
|--------|------|
| OpenAI | GPT-4o 等 |
| 兼容 API | DeepSeek / 通义千问 / Moonshot 等 |
| Ollama | 本地模型 |
| LM Studio | 本地模型 |

多模型 Profile 配置，可在设置中切换。

## AI 润色功能

内置 AI 润色助手，帮助快速创建专业的 Agent SOUL.md 文档。

### 零配置使用（推荐）

直接使用本地 OpenClaw，无需配置任何 API Key：

```bash
brew install openclaw
```

### 可选：使用外部 API

创建 `.env` 文件：

```bash
AI_API_KEY=your-api-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
```

智能降级：有外部 API Key → 使用外部 API；无 → 自动使用 OpenClaw。

## 项目结构

```
manta/
├── app/              # Next.js 页面 + API 路由
│   ├── (pages)/      # 功能页面（kanban, tasks, workflows, agents, skills, mcp, settings）
│   └── api/          # API 路由（agents, chat, tasks, workflows, mcp, conversations, logs, plugins, skills, fs, runners）
├── core/             # 核心引擎层
│   ├── workflow-engine/  # 工作流执行引擎（状态机、步骤编排、持久化）
│   ├── runner/       # Agent Runner 执行层（openclaw CLI）
│   ├── chat/         # AI 聊天核心（Agent Loop、流式处理、循环检测）
│   ├── llm/          # LLM 提供商层（OpenAI / Ollama / LM Studio）
│   ├── tool-registry/ # 工具注册中心 + MCP 客户端管理
│   ├── conversation/ # 会话管理 + CC 工具集
│   ├── channel/      # 通知层（系统通知 + Webhook）
│   ├── log/          # 日志系统
│   └── fs/           # 文件访问控制
├── design/           # 60+ 设计规范主题
├── plugins/          # 插件系统（openclaw, plateco）
├── workflows/        # 工作流定义（YAML）
├── config/           # 配置（敏感信息检测规则）
├── electron/         # Electron 桌面端
├── scripts/          # 构建 / 发布 / 检测脚本
└── docs/             # 文档
```

## 📦 构建和安装

```bash
pnpm build
```

### macOS 安装提示"已损坏"的解决方案

应用未进行代码签名，macOS 会触发 Gatekeeper 安全提示：

```bash
# 方法1: 使用项目脚本
chmod +x scripts/fix-macos-quarantine.sh
./scripts/fix-macos-quarantine.sh /Applications/Manta.app

# 方法2: 手动移除隔离标记
sudo xattr -rd com.apple.quarantine /Applications/Manta.app

# 方法3: 右键点击应用 → 选择"打开" → 在警告对话框中点击"打开"
```

> 详细解决方案请参考 [macOS Gatekeeper 修复指南](docs/macos-gatekeeper-fix.md)。

## Git 提交敏感信息检查

项目已配置 Git pre-commit 钩子，自动检测 API 密钥、Token、私钥等敏感信息。

```bash
# 安装钩子
chmod +x scripts/install-hooks.sh
./scripts/install-hooks.sh

# 手动运行检查
npm run check:sensitive

# 自定义检测规则
# 编辑 config/sensitive-rules.yaml
```

内置检测规则：API Key、Bearer Token、JWT、私钥、AWS 密钥、密码、数据库连接串、手机号、身份证号等 15+ 条。

## 致谢

### 设计系统

Manta 的多主题系统灵感和设计 token 提取自以下开源项目：

- **[VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md)** — 汇集 60+ 款知名产品设计规范的开源合集，以 Markdown 格式整理，供 AI Agent 直接读取并生成一致的 UI。

  > *"Copy a DESIGN.md into your project, tell your AI agent 'build me a page that looks like this' and get pixel-perfect UI that actually matches."*
