# Manta · AI Native 智能体应用平台

> 不只是运行 Agent，而是**搭建、喂养、评估、上线**属于你自己的智能体应用——按需组合，不需按顺序。

Manta 是一个 **AI Native 智能体应用平台**。每个 Agent 不再只是一次对话，而是一个拥有独立知识库、工具集、评估能力和发布通道的**智能体应用**。

四大能力模块可独立使用，也可自由组合——你不需要的，不存在；你需要的，随时接入。

**版本**: v2.1.0 | **技术栈**: Next.js 15 · React 19 · TypeScript · Electron · Tailwind CSS

---

## 核心理念：Agent as Application

传统的 AI 助手是一个聊天框：你问，它答，然后什么都没留下。Manta 把每一次 Agent 交互变成**可构建、可迭代、可交付的应用单元**。

```
┌──────────────────────────────────────────────────────────────────┐
│                     Agent Application                            │
│                                                                   │
│   ┌──────────────┐  ┌──────────────┐                             │
│   │  应用搭建器   │  │  RAG 知识库  │  ← 按需组合，无先后顺序     │
│   │              │  │              │                             │
│   │ · Agent 绑定 │  │ · 文档上传   │                             │
│   │ · 工具配置   │  │ · 智能分块   │                             │
│   │ · Prompt 调优│  │ · 向量化     │                             │
│   │ · 自动化编排 │  │ · 混合检索   │                             │
│   └──────┬───────┘  └──────┬───────┘                             │
│          │                 │                                      │
│          │    自由组合     │                                      │
│          │                 │                                      │
│   ┌──────┴───────┐  ┌──────┴───────┐                             │
│   │  评估流水线   │  │  自动化发布   │                             │
│   │              │  │              │                             │
│   │ · RAGAs 7维  │  │ · 定时任务   │                             │
│   │ · Agent评估  │  │ · Webhook    │                             │
│   │ · 数据集管理 │  │ · 状态管理   │                             │
│   │ · 对比实验   │  │ · 版本控制   │                             │
│   └──────────────┘  └──────────────┘                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    可观测性引擎（内置）                       │ │
│  │                                                              │ │
│  │  📋 日志系统          📁 会话系统          🧠 上下文系统     │ │
│  │  每步工具调用 →      完整消息历史 →       Prompt 构建过程 → │ │
│  │  Token 消耗 →        工具使用分布 →       上下文压缩策略 →  │ │
│  │  循环检测告警         持久化存储           每步快照          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

> **Agent 不是一个功能，而是一个产品。** Manta 提供的是一个能力矩阵，你可以只取所需、随时扩展。

---

## 核心特性

### Agent 执行引擎

- **Agent Loop 流式输出** — 手动实现的 while 循环，每步调用 streamText 保持真流式推理，实时展示工具调用过程
- **循环检测** — 内置指纹比对 + 语义分析，自动检测 Agent 陷入循环并中断，避免资源浪费
- **Token 预算管理** — 支持输出 token 上限（默认 1M）和安全兜底步数（默认 200 步），防止无限循环
- **上下文压缩** — 自动压缩长对话历史，支持 microcompact 和 TTL 过期清理
- **Prompt Cache** — 支持 OpenAI 等 provider 的 prompt 缓存机制，降低重复上下文的计算成本

### Claude Code 风格工具集

Manta 实现了一套完整的工具系统，分为两个层级：

**文件系统工具（带访问控制）**：
- `readFile` — 读取文件内容（支持行号范围截取）
- `lsDir` — 列出目录内容
- `glob` — 按 glob 模式匹配文件
- `grep` — 在文件内容中搜索正则模式

**文件操作工具（无访问控制）**：
- `read` — 读取文件内容
- `write` — 写入/覆盖文件
- `edit` — 精确字符串替换
- `multiEdit` — 批量字符串替换（原子操作）

**Bash 工具**：
- `bash` — 执行 shell 命令（支持后台运行、超时控制）
- `bashOutput` — 获取后台任务输出
- `bashKill` — 终止后台任务

**网络工具**：
- `webFetch` — 抓取网页内容并提取关键信息
- `webSearch` — 通过 DuckDuckGo 搜索互联网

**任务管理工具**：
- `todoRead` — 读取待办事项列表
- `todoWrite` — 写入待办事项列表

**会话管理工具**：
- 会话 CRUD 操作、历史查询、上下文管理

### MCP 协议支持

- **完整的 Model Context Protocol** — 支持 local（stdio）和 remote（HTTP + OAuth）MCP 服务器连接
- **工具可见性控制** — 细粒度控制每个 MCP 服务器暴露的工具列表，支持 per-agent 的 glob 模式过滤
- **OAuth 认证流程** — 完整的 OAuth 2.0 授权码流程，支持远程 MCP 服务的身份认证
- **运行时动态管理** — 支持运行时动态连接/断开 MCP 服务器
- **工具搜索** — 内置 tool_search 元工具，支持语义搜索可用工具

### LLM 多模型支持

- **OpenAI** — GPT-4o 等原生模型
- **兼容 API** — DeepSeek / 通义千问 / Moonshot 等任意 OpenAI 兼容接口
- **Ollama** — 本地模型（llama3、qwen、mistral 等）
- **LM Studio** — 本地模型
- **MiMo 适配** — 特殊适配小米 MiMo 模型的 reasoning_content 字段，支持推理过程回传

### 主题系统

- **65 个设计主题** — 灵感来源于 Apple、Linear、Notion、Vercel、Stripe、Figma、Shopify 等知名产品的设计规范
- **亮暗双模** — CSS 变量驱动，主题切换即时生效
- **自定义微调** — 在设置中自由修改颜色、字体、圆角等变量
- **默认主题** — WorkBuddy 极简白底风格

### Agent 可观测性三件套

Manta 的杀手级特性：通过日志、会话、上下文三个系统联动，将 Agent 的执行过程**完全透明化**。无论是学习 Agent 原理、排查执行问题，还是优化 Prompt 设计，这套系统都能提供完整的数据支撑。

---

#### 📋 日志系统 — Agent 的"行车记录仪"

覆盖 Agent Loop 的**每一步执行细节**，10 种日志类型、5 个日志级别、5 个日志来源：

| 日志类型 | 记录内容 | 排障场景 |
|---------|---------|---------|
| `TOOL_CALL` | 工具名称、输入参数、输出结果、是否报错 | 工具调用失败、参数错误 |
| `MODEL_OUTPUT` | 模型文本输出、Token 用量（input/output/cache） | Token 消耗异常、输出质量问题 |
| `AGENT_LOOP` | 每步摘要（消息数、工具数、Token 数、耗时） | 步骤过多、循环检测 |
| `SYSTEM` | 系统事件（启动、关闭、配置变更） | 环境问题 |
| `PERFORMANCE` | 内存/CPU 使用、耗时分布 | 性能瓶颈 |
| `METRICS` | 结构化指标数据 | 成本分析、质量评估 |
| `ERROR` | 错误类型、消息、堆栈、错误码 | 异常排查 |
| `SECURITY` | 安全检查事件 | 安全审计 |

**日志元数据**：每条日志自动携带 `conversationId`、`messageId`、`stepIndex`、`toolCallId`、`toolName`，可精确定位到任意会话的任意步骤。

**持久化策略**：
- 全局日志：`~/.manta-data/system.log`（NDJSON 格式，可 grep/jq 分析）
- 会话专属日志：`~/.manta-data/conversations/<id>/log.ndjson`（按会话隔离）
- 内存缓存 10000 条，支持实时 WebSocket 推送

**SystemLogs UI** — 功能丰富的日志查看器：
- 按 **Turn（对话轮次）→ Step（执行步骤）** 两级分组
- 每步头部显示彩色 Token 数字（输入 → 缓存 → 输出），格式如 `12k + 3k → 800`
- 每条日志可展开查看完整详情（时间戳、类型、来源、消息体、details JSON、metadata JSON、标签）
- 按级别/类型/来源/关键词过滤，支持搜索、导出、复制

---

#### 📁 会话系统 — Agent 的"黑匣子"

每个会话保存**完整的执行记录**，后续可随时回放分析：

**会话文件结构**：
```
~/.manta-data/conversations/<uuid>/
├── session.json    # 完整消息历史 + 元数据
└── log.ndjson      # 按时间线的执行日志
```

**session.json 包含**：
- `messages[]` — 用户消息和助手回复的完整列表
- `toolCalls[]` — 每条消息关联的工具调用记录（名称、参数、结果）
- `usage` — Token 用量（input/output/cacheRead/cacheWrite/noCache）
- `stepUsages[]` — 每一步的 Token 明细
- `context` — 灵活的运行时上下文存储

**SessionSidebar UI** 提供 5 个标签页：
1. **文件** — Agent 创建/编辑的文件清单
2. **变更** — 文件修改记录（create/edit/delete）
3. **Session** — 会话信息 + 消息统计 + Token 用量 + 工具使用分布
4. **上下文** — ContextView 面板
5. **日志** — SystemLogs 面板

**存储安全**：采用原子写入（先写 `.tmp` 再 `rename`），断电不损坏数据。

---

#### 🧠 上下文系统 — Agent 的"思维构建过程"

Manta 不只是把用户输入发给 LLM，而是通过 **Prompt Pipe 管道模式**精心构建每一轮的 System Prompt。ContextView 让你**实时看到 Prompt 是如何组装的**。

**Prompt Pipe 管道**（6 个标准 Pipe，按 KV Cache 优化顺序排列）：

| Pipe | 内容 | 条件 |
|------|------|------|
| `coreRules` | 身份定位 + 通信风格 + 安全边界 + 代码风格 | 始终输出 |
| `toolGuide` | 工具使用规则（支持延迟加载机制） | 有注册工具时 |
| `workingDirectory` | 当前工作目录路径 | 始终输出 |
| `deferredTools` | 延迟工具摘要列表 | 有延迟工具时 |
| `agentSoul` | Agent SOUL.md 个性化内容 | SOUL.md 存在时 |
| `sessionContext` | 会话历史消息数 | 有历史消息时 |

**4 层上下文压缩策略**：长对话自动压缩，保持上下文在窗口限制内：

| 策略 | 机制 | 触发条件 |
|------|------|---------|
| Microcompact | 清理旧的查询类工具结果，保留最近 3 个 | 步骤数过多 |
| 动态截断 | 单条大结果 Head/Tail 60/40 分割，总量超窗口 75% 逐条 compact | 上下文接近窗口上限 |
| TTL 修剪 | 5 分钟软修剪（Head/Tail 保留）、10 分钟硬清除 | 时间衰减 |
| Compaction | LLM 摘要压缩早期对话为结构化摘要 | 上下文严重超限 |

**ContextView UI**：
- System Prompt 总览 — 各 Pipe 段的启用状态和 Token 估算
- 上下文快照 — 每一步执行前的完整消息列表
- Agent 步骤视图 — 每步的消息数/工具数/Token 数，标记被压缩/截断的消息
- 5 秒自动刷新，实时观察上下文变化

---

#### 🔬 三系统联动：完整回溯 Agent 决策过程

```
Step 1: Agent 调用 grep 搜索代码
  ├── 📋 日志：TOOL_CALL { toolName: "grep", input: { pattern: "login" }, output: "3 matches" }
  ├── 📁 会话：session.json 中追加 toolCall 记录 + stepUsage
  └── 🧠 上下文：ContextView 显示 System Prompt 包含 coreRules + toolGuide + workingDirectory

Step 2: Agent 调用 read 读取匹配文件
  ├── 📋 日志：TOOL_CALL { toolName: "read", output: "<file content>" }
  ├── 📁 会话：消息列表新增一条助手消息，包含两个工具调用
  └── 🧠 上下文：上下文快照记录第 1 步的结果已作为上下文注入

... (循环直到任务完成)

Turn 结束：
  ├── 📋 日志：MODEL_OUTPUT + AGENT_LOOP（聚合摘要，一行看完所有关键指标）
  ├── 📁 会话：session.json 写入磁盘，log.ndjson 追加全量日志
  └── 🧠 上下文：Microcompact 清理旧查询结果，TTL 标记过期消息
```

> **这就是 Manta 的核心价值**：你不仅能看到 Agent 做了什么，还能理解它**为什么这么做**、**Prompt 是怎么构建的**、**每一步消耗了多少 Token**。

---

### 更多特性

- **通知系统** — macOS 系统通知 + Webhook（飞书 / Slack / 钉钉 / Discord）
- **文件安全** — CWD 内自由访问，CWD 外需用户实时授权
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
| 应用中心 | `/apps` | 开发中 | 智能体应用管理：创建、配置、知识喂养、评估、发布（按需组合） |
| 应用详情 | `/apps/[id]` | 开发中 | 应用工作空间：独立对话历史、知识库管理、工具配置、状态面板 |
| 应用搭建器 | `/apps/[id]/builder` | 开发中 | 可视化配置 Agent：Prompt 调优、工具选择、RAG 绑定、自动化编排 |
| RAG 知识库 | `/rag` | 规划中 | 多引擎知识库：文档上传、智能分块、向量化、混合检索 |
| 评估流水线 | `/evaluation` | 规划中 | RAGAs + Agent 双维度评估：数据集管理、对比实验、评分报告 |
| MCP Server | `/mcp` | 已完成 | MCP 服务器管理（stdio / HTTP / OAuth），工具可见性控制 |
| 设置 | `/settings` | 已完成 | LLM 配置、Webhook 通知、自动更新、主题微调 |
| 主题选择 | `/themes` | 已完成 | 65 款设计主题浏览与一键切换 |

---

## 界面预览

### AI 聊天界面

核心交互界面，中间对话区展示 Agent 推理和工具调用过程，右侧**执行日志面板**实时显示每一步的详细信息。

![AI 聊天界面](docs/screenshots/chat-interface.png)

### 会话详情与统计

每个会话的完整"黑匣子"——消息历史、工具调用记录、Token 用量统计，所有数据持久化可回溯。

![会话详情](docs/screenshots/session-details.png)

### Agent 执行日志

按 Turn → Step 两级分组的**全链路执行日志**，每一步的工具调用、模型输出、Token 消耗、耗时都清晰可见。

![执行日志](docs/screenshots/execution-log.png)

### 上下文总览

**System Prompt 的构建过程可视化**：Prompt Pipe 各段落的 Token 占比、每步上下文快照、消息被压缩/截断的标记。

![上下文视图](docs/screenshots/context-view.png)

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                      app/ (Next.js UI)                            │
│  pages: /tasks  /mcp  /settings  /themes                          │
│  components: SystemLogs  ContextView  SessionSidebar  MetricsDashboard│
│  api: agents chat conversations mcp logs plugins fs config         │
├──────────────────────────────────────────────────────────────────┤
│                      core/ (引擎层)                                 │
│                                                                    │
│  ┌──────────┐  ┌──────┐  ┌───────────────┐  ┌─────────────────┐ │
│  │  chat/   │  │ llm/ │  │ conversation/ │  │ workflow-engine/│ │
│  │Agent Loop│  │多模型│  │  会话存储     │  │  工作流编排     │ │
│  └────┬─────┘  └──────┘  └───────────────┘  └─────────────────┘ │
│       │                                                            │
│       │  ┌────────────────── 可观测性层 ───────────────────┐      │
│       │  │                                                   │      │
│       ├──┤  📋 log/        日志采集 · 格式化 · 持久化 · UI   │      │
│       ├──┤  📁 conversation/ 会话 CRUD · 消息存储 · 统计    │      │
│       └──┤  🧠 context/     Prompt Pipe · 压缩 · 快照       │      │
│          │                                                   │      │
│          └───────────────────────────────────────────────────┘      │
│                                                                    │
│  ┌──────────────┐  ┌──────────┐  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │tool-registry/ │  │ channel/ │  │tools/│  │ fs/  │  │config│   │
│  │MCP客户端+OAuth│  │  通知层  │  │工具集│  │安全层│  │ 配置 │   │
│  └──────────────┘  └──────────┘  └──────┘  └──────┘  └──────┘   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
manta/
├── app/                  # Next.js 页面 + API 路由
│   ├── tasks/            # AI 聊天页
│   ├── mcp/              # MCP 服务器管理页
│   ├── settings/         # 设置页
│   ├── themes/           # 主题选择页
│   ├── components/       # SidebarNav, SessionSidebar, SettingsModal, SystemLogs
│   └── api/              # REST API（agents, chat, conversations, mcp, logs, plugins, fs, config）
├── core/                 # 核心引擎层（纯 TypeScript，零 UI 依赖）
│   ├── chat/             # Agent Loop · 流式处理 · 循环检测 · 错误格式化
│   │   ├── agent-loop.ts       # 核心执行循环（while + streamText，真流式）
│   │   └── loop-detector/      # 指纹比对 + 语义分析 · 三级循环检测
│   ├── llm/              # LLM 提供商 — OpenAI / 兼容 API / Ollama / LM Studio / MiMo
│   ├── conversation/     # 📁 会话系统 — store.ts（会话CRUD + 原子写入 + 向后兼容迁移）
│   ├── log/              # 📋 日志系统
│   │   ├── types.ts            # 10种日志类型 · 5级 · 5来源 · LogMetadata
│   │   ├── collector.ts        # 内存收集器（10000条缓存 · 过滤器 · 订阅机制）
│   │   ├── formatter.ts        # 5种输出格式（JSON/CSV/Text/HTML/Terminal）
│   │   └── hooks.ts            # React hooks（useLogs/useLogStats）
│   ├── context/          # 🧠 上下文系统
│   │   ├── prompt-builder.ts   # Prompt Pipe 管道模式（6个标准Pipe）
│   │   ├── agent-soul.ts       # SOUL.md 个性化 System Prompt
│   │   ├── microcompact.ts     # 旧查询结果清理
│   │   ├── truncate-tool-results.ts  # Head/Tail 分割截断
│   │   ├── ttl-prune.ts        # 时间衰减修剪（5min/10min）
│   │   ├── compaction.ts       # LLM 摘要压缩
│   │   └── context-snapshot.ts # 每步上下文快照
│   ├── metrics/          # 指标系统 — StepMetrics · TurnMetrics · SessionMetrics
│   ├── tool-registry/    # MCP 客户端 · OAuth · 工具搜索 · 可见性控制
│   ├── tools/            # 工具实现 — Bash / FileOps / FsAccess / Web / Todo
│   ├── channel/          # 通知层 — macOS 系统通知 + Webhook（飞书/Slack/钉钉/Discord）
│   ├── workflow-engine/  # 工作流引擎 — 状态机 · 步骤编排 · YAML 加载器
│   ├── fs/               # 文件安全 — CWD 访问控制
│   └── config/           # 工作空间配置
├── design/               # 65 个设计规范主题（Apple、Linear、Notion、Vercel 等）
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
| OpenAI | GPT-4o 等原生模型 |
| 兼容 API | DeepSeek / 通义千问 / Moonshot 等任意 OpenAI 兼容接口 |
| Ollama | 本地模型（llama3、qwen、mistral 等） |
| LM Studio | 本地模型 |
| MiMo | 小米推理模型（特殊适配 reasoning_content 字段） |

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
- **Agent 可观测性三件套**（日志系统 + 会话系统 + 上下文系统）— 完整回溯 Agent 决策过程
- AI 聊天引擎（Agent Loop + 真流式 + 循环检测 + 4 层上下文压缩）
- MCP 协议完整支持（stdio / HTTP / OAuth + 可见性控制）
- Claude Code 风格工具集（Bash / File / Web / Todo）
- LLM 多模型配置（OpenAI / Ollama / LM Studio / 兼容 API / MiMo）
- 65 款设计主题 + CSS 变量驱动
- 文件安全（CWD 访问控制）
- Electron 桌面打包 + 自动更新
- 敏感信息检测

### Phase 1 — 应用基础设施 (v2.1) 进行中
- 应用 CRUD 与存储层
- 应用列表页 + 应用详情页
- 应用状态机（draft → published → archived）
- 侧边栏导航扩展

### Phase 2 — 应用搭建器
- 可视化 Agent 配置（Prompt / 模型参数 / 工具选择）
- RAG 知识库绑定
- 自动化任务编排（Cron / Webhook）
- 实时预览

### Phase 3 — RAG 知识引擎
- 多后端知识库（SQLite / Milvus / Chroma / BM25）
- 文档上传与智能分块
- 向量化流水线
- 混合检索（向量 + 关键词）

### Phase 4 — 评估流水线
- RAGAs 评估（Faithfulness / Relevance / Precision 等）
- Agent 评估（任务成功率 / 步骤效率 / 工具使用）
- 数据集管理与标注
- 对比实验

### Phase 5 — 上线与生态
- 定时任务 + Webhook 触发
- 应用版本管理
- 应用分享与协作
- 应用模板市场

---

## 设计系统致谢

Manta 的多主题系统的灵感和设计 token 提取自以下开源项目：

- **[VoltAgent / awesome-design-md](https://github.com/VoltAgent/awesome-design-md)** — 汇集 65 款知名产品设计规范的开源合集，以 Markdown 格式整理，供 AI Agent 直接读取并生成一致的 UI。

  > *"Copy a DESIGN.md into your project, tell your AI agent 'build me a page that looks like this' and get pixel-perfect UI that actually matches."*

---

## License

Private. Built with Next.js, React, TypeScript, and Tailwind CSS.
