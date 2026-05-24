# Manta · Agent 调度操作系统

> Humans steer. Agents execute. Drivers are pluggable.

多 Agent 协作调度桌面应用，基于 Next.js 15 + React 19 + TypeScript 全栈实现，支持 AI 聊天、MCP 工具集成、插件系统和 Electron 打包。

**版本**: v2.0.0 | **最新更新**: 2026-05-24

---

## 核心特性

### AI 聊天引擎
- **Agent Loop 流式输出** — 多轮对话，真流式推理，实时展示工具调用过程，Markdown + 代码高亮渲染
- **循环检测** — 内置指纹比对 + 语义分析，自动检测 Agent 陷入循环并中断，避免资源浪费
- **Claude Code 风格工具集** — Bash / Read / Write / Edit / Glob / Grep / WebFetch / WebSearch / Todo，延迟加载与智能搜索
- **会话管理** — 多会话独立上下文，历史持久化，Agent 切换

### MCP 协议支持
- **完整的 Model Context Protocol** — 支持 local（stdio）和 remote（HTTP + OAuth）MCP 服务器连接
- **工具可见性控制** — 细粒度控制每个 MCP 服务器暴露的工具列表
- **OAuth 认证流程** — 完整的 OAuth 2.0 授权码流程，支持远程 MCP 服务的身份认证

### 插件系统
- **可插拔 Runner / Agent 架构** — 通过 `plugin.yaml` 声明插件，自动扫描 Agent 并注入系统
- **当前插件** — OpenClaw（原生 CLI Agent）、PlateCo（前端开发专用）
- **npm 安装** — 支持通过 npm 安装社区插件，即装即用

### 主题系统
- **65 个设计主题** — 灵感来源于 Apple、Linear、Notion、Vercel、Stripe 等知名产品的设计规范
- **亮暗双模** — CSS 变量驱动，主题切换即时生效
- **自定义微调** — 在设置中自由修改颜色、字体、圆角等变量
- **默认主题** — WorkBuddy 极简白底风格

### 更多特性
- **LLM 多模型** — 支持 OpenAI（GPT-4o 等）、兼容 API（DeepSeek / 通义千问 / Moonshot 等）、Ollama 本地模型、LM Studio 本地模型
- **日志系统** — 全链路日志采集、格式化、实时 WebSocket 推送、统计报告、导出
- **通知系统** — macOS 系统通知 + Webhook（飞书 / Slack / 钉钉 / Discord）
- **文件安全** — CWD 内自由访问，CWD 外需用户实时授权
- **工作流引擎（核心就绪）** — 状态机 + 步骤编排引擎已实现，支持 sequential / parallel / human_in_loop / conditional / loop，YAML 定义
- **Electron 桌面端** — 原生桌面应用打包，自动更新（GitHub Releases）
- **敏感信息检测** — Git pre-commit 钩子，自动检测 API 密钥、Token、私钥等 15+ 类敏感信息

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（Next.js + Electron）
npm run dev

# 仅启动 Web 端
npm run dev:next

# 生产构建
pnpm build
```

访问 http://localhost:3000（默认进入 AI 聊天页）

---

## 功能页面

| 页面 | 路径 | 状态 | 说明 |
|------|------|------|------|
| AI 聊天 | `/tasks` | 已完成 | 流式聊天，Agent 选择，工具调用展示，会话管理，Markdown 渲染 |
| MCP Server | `/mcp` | 已完成 | MCP 服务器管理（stdio / HTTP / OAuth），工具可见性控制 |
| 设置 | `/settings` | 已完成 | LLM 配置、Runner 探测、Webhook 通知、插件管理、自动更新、主题微调 |
| 主题选择 | `/themes` | 已完成 | 65 款设计主题浏览与一键切换 |

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                    app/ (Next.js UI)                 │
│   pages: /tasks  /mcp  /settings  /themes            │
│   api: agents chat conversations mcp logs plugins    │
├─────────────────────────────────────────────────────┤
│                    core/ (引擎层)                     │
│                                                      │
│  ┌──────────┐ ┌──────┐ ┌───────────────┐           │
│  │  chat/   │ │ llm/ │ │ conversation/ │           │
│  │Agent Loop│ │多模型│ │  会话+CC工具   │           │
│  └──────────┘ └──────┘ └───────────────┘           │
│                                                      │
│  ┌──────────────┐ ┌──────────┐ ┌──────────┐        │
│  │tool-registry/ │ │ runner/  │ │ channel/ │        │
│  │ MCP客户端管理  │ │ CLI执行  │ │  通知层   │        │
│  └──────────────┘ └──────────┘ └──────────┘        │
│                                                      │
│  ┌──────────────┐ ┌──────┐ ┌──────┐ ┌──────┐      │
│  │workflow-engine│ │ log/ │ │ fs/  │ │config│      │
│  │  工作流编排   │ │日志系统│ │文件安全│ │ 配置 │      │
│  └──────────────┘ └──────┘ └──────┘ └──────┘      │
├─────────────────────────────────────────────────────┤
│              plugins/ (插件层)                        │
│         openclaw  •  plateco  •  ...                 │
└─────────────────────────────────────────────────────┘
```

---

## 项目结构

```
manta/
├── app/                  # Next.js 页面 + API 路由
│   ├── tasks/            # AI 聊天页 (58KB)
│   ├── mcp/              # MCP 服务器管理页 (49KB)
│   ├── settings/         # 设置页 (42KB)
│   ├── themes/           # 主题选择页 (23KB)
│   ├── components/       # SidebarNav, SessionSidebar, SettingsModal, SystemLogs
│   └── api/              # REST API（agents, chat, conversations, mcp, logs, plugins, fs, config）
├── core/                 # 核心引擎层（55 个文件，纯 TypeScript，零 UI 依赖）
│   ├── chat/             # AI 聊天引擎 — Agent Loop、流式处理、循环检测、错误格式化
│   ├── llm/              # LLM 提供商 — OpenAI / 兼容 API / Ollama / LM Studio
│   ├── tool-registry/    # 工具注册中心 — MCP 客户端、OAuth、工具搜索、可见性控制
│   ├── conversation/     # 会话管理 — Claude Code 风格工具集（31KB）、FS 工具、会话存储
│   ├── log/              # 日志系统 — 采集、格式化、Hook、WebSocket 推送、统计报告
│   ├── workflow-engine/  # 工作流引擎 — 状态机、步骤编排、YAML 加载器
│   ├── runner/           # Agent Runner — 进程注册、CLI 执行
│   ├── channel/          # 通知层 — macOS 系统通知 + Webhook
│   ├── fs/               # 文件安全 — CWD 访问控制
│   └── config/           # 工作空间配置
├── design/               # 65 个设计规范主题（Apple、Linear、Notion、Vercel 等）
├── plugins/              # 插件系统（openclaw, plateco）+ 加载器
├── workflows/            # 工作流 YAML 定义
│   ├── dev-standard.yaml            # 需求开发流
│   ├── quick-fix.yaml               # 快速修复流
│   └── plateco-frontend-dev.yaml    # 前端 14 阶段全流程
├── config/               # 敏感信息检测规则
├── electron/             # Electron 桌面端主进程
├── scripts/              # 构建、发布、敏感信息检测、版本管理
├── docs/                 # 架构文档、AI 润色指南、macOS 修复等
└── registry/             # Agent 注册表
```

---

## LLM 配置

在设置页配置多模型 Profile，运行时切换：

| 提供商 | 说明 |
|--------|------|
| OpenAI | GPT-4o 等 |
| 兼容 API | DeepSeek / 通义千问 / Moonshot 等任意 OpenAI 兼容接口 |
| Ollama | 本地模型（llama3、qwen、mistral 等） |
| LM Studio | 本地模型 |

---

## 插件系统使用

### 内置插件

- **OpenClaw** — 原生 CLI Agent Runner，支持 `brew install openclaw` 安装
- **PlateCo** — 前端开发专用工作流插件

### 通过 npm 安装新插件

```bash
npm install <plugin-package>
```

插件安装后自动扫描并注入系统，无需额外配置。管理入口：设置 → 插件管理。

---

## 构建与发布

```bash
# 生产构建（Next.js + Electron 打包）
pnpm build

# 构建脚本负责：
# 1. Next.js 静态构建
# 2. Electron 应用打包
# 3. macOS .dmg 生成
```

### macOS 安装提示"已损坏"

应用未进行代码签名，macOS 会触发 Gatekeeper 安全提示：

```bash
# 方法1: 使用项目脚本
chmod +x scripts/fix-macos-quarantine.sh
./scripts/fix-macos-quarantine.sh /Applications/Manta.app

# 方法2: 手动移除隔离标记
sudo xattr -rd com.apple.quarantine /Applications/Manta.app

# 方法3: 右键点击应用 → 选择"打开" → 在警告对话框中点击"打开"
```

> 详见 [macOS Gatekeeper 修复指南](docs/macos-gatekeeper-fix.md)

---

## Git 敏感信息检查

项目已配置 Git pre-commit 钩子，自动检测 API 密钥、Token、私钥等敏感信息。

```bash
# 安装钩子
chmod +x scripts/install-hooks.sh
./scripts/install-hooks.sh

# 手动运行检查
npm run check:sensitive
```

内置 15+ 条检测规则：API Key、Bearer Token、JWT、私钥、AWS 密钥、密码、数据库连接串、手机号、身份证号等。

---

## 开发路线

### 已完成 (v2.0.0)
- AI 聊天引擎（Agent Loop + 流式 + 循环检测）
- MCP 协议完整支持（stdio / HTTP / OAuth + 可见性控制）
- 会话管理与 Claude Code 工具集
- LLM 多模型配置（OpenAI / Ollama / LM Studio / 兼容 API）
- 插件系统（加载器 + OpenClaw + PlateCo）
- 65 款设计主题 + CSS 变量驱动
- 日志系统（采集 / WebSocket / 统计 / 导出）
- 文件安全（CWD 访问控制）
- Electron 桌面打包 + 自动更新
- 敏感信息检测

### 规划中
- 任务看板（Kanban）与工作流可视化编辑器
- Agent 管理页面（CRUD + AI 润色 UI）
- Skills 技能库前端页面
- 工作流 API 层接线（引擎已就绪）
- Processing 处理中心

---

## 设计系统致谢

Manta 的多主题系统的灵感和设计 token 提取自以下开源项目：

- **[VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md)** — 汇集 65 款知名产品设计规范的开源合集，以 Markdown 格式整理，供 AI Agent 直接读取并生成一致的 UI。

  > *"Copy a DESIGN.md into your project, tell your AI agent 'build me a page that looks like this' and get pixel-perfect UI that actually matches."*

---

## License

Private. Built with Next.js, React, TypeScript, and Tailwind CSS.
