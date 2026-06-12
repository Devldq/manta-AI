# AI 润色功能使用指南

## 功能简介

在 Agent 管理页面的新增/编辑 Agent 时，提供 AI 辅助生成 SOUL.md 的能力，帮助你快速创建专业、结构化的 Agent 定义文档。

**✨ 零配置体验**：优先使用本地 OpenClaw CLI，无需外部 API Key！

## 配置方式

### 方式 1: 零配置（推荐）✨

**使用本地 OpenClaw CLI**，无需任何配置！

前提条件：
- 已安装 OpenClaw CLI
- OpenClaw 已配置 AI 模型

如何检查：
```bash
# 检查 OpenClaw 是否安装
openclaw --version

# 查看模型配置
cat ~/.openclaw/openclaw.json
```

首次使用时，系统会自动创建 `polish-helper` Agent，完全自动化！

### 方式 2: 使用外部 API

如果想使用外部 OpenAI API（更快或更强的模型），可以配置环境变量：

在项目根目录创建 `.env` 文件（或复制 `.env.example`），配置以下环境变量：

```bash
# 方式 1: 使用 AI_* 前缀
AI_API_KEY=your-api-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini

# 方式 2: 使用 OPENAI_* 前缀（兼容）
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

#### 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `AI_API_KEY` / `OPENAI_API_KEY` | ❌ | - | OpenAI 兼容接口的 API Key（可选） |
| `AI_BASE_URL` / `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | API 基础 URL |
| `AI_MODEL` / `OPENAI_MODEL` | ❌ | `gpt-4o-mini` | 使用的模型名称 |

#### 兼容的 AI 服务

- **Azure OpenAI**: 配置 `AI_BASE_URL` 为 Azure 端点
- **国内代理服务**: 配置 `AI_BASE_URL` 为代理地址
- **本地部署模型**: 如 Ollama、LocalAI 等，配置对应的本地 URL
- **其他兼容服务**: 任何实现 OpenAI Chat Completions API 的服务

### 自动降级策略

系统会智能选择最佳方案：

1. **优先级 1**: 如果配置了外部 API Key → 使用外部 API（速度更快）
2. **优先级 2**: 如果未配置外部 API → 自动降级到 OpenClaw（零配置）
3. **失败提示**: 如果 OpenClaw 也不可用 → 提示用户安装或配置

**完全自动化，对用户透明！**

### 2. 重启应用（仅修改 .env 时需要）

修改 `.env` 文件后，需要重启应用使配置生效：

```bash
npm run dev
```

## 使用场景

### 场景 1: 新建 Agent

1. 点击「+ 新建」按钮
2. 填写 Agent 名称和描述
3. 在「✨ AI 润色助手」区域填写：
   - **核心职责**: Agent 的主要职责（可选）
   - **工作流程**: Agent 的工作流程（可选）
4. 点击「✨ AI 生成 SOUL.md」按钮
5. AI 会根据你提供的信息生成完整的 SOUL.md 文档
6. 可以继续手动编辑优化，或点击「创建并注入」完成创建

### 场景 2: 编辑现有 Agent

#### Manta 托管 Agent
1. 在左侧列表选择一个 Manta Agent
2. 点击右上角「编辑」按钮
3. 点击「✨ AI 润色」链接展开润色助手
4. 填写补充信息后点击「✨ AI 优化 SOUL.md」
5. AI 会基于当前内容进行优化改进

#### OpenClaw 外部 Agent（可编辑）
1. 在左侧列表选择一个标记为「可编辑」的 Agent
2. 点击右上角「编辑」按钮
3. 使用方式同 Manta Agent

## 工作原理

1. **收集信息**: 收集 Agent 名称、描述、职责、流程等信息
2. **构建提示词**: 将信息组织成结构化的提示词
3. **调用 AI API**: 使用 OpenAI 兼容接口生成内容
4. **返回结果**: 将生成的 SOUL.md 填充到编辑器

## 提示词策略

AI 润色使用以下系统提示词：

```
你是一个专业的 AI Agent 架构师，擅长编写清晰、结构化的 Agent SOUL.md 文档。
SOUL.md 是 Agent 的核心定义文档，包含身份、职责、工作流程等关键信息。

要求：
1. 使用 Markdown 格式
2. 包含核心章节：# Agent · SOUL、## 身份、## 职责、## 工作流程
3. 内容简洁明了，突出 Agent 的核心价值和工作方式
4. 如果信息不完整，请合理推断补充
5. 保持专业、务实的语气
```

## API 端点

### POST /api/agents/polish

润色 SOUL.md 内容

**请求体**:
```json
{
  "name": "agent-name",           // 可选：Agent 名称
  "description": "...",           // 可选：Agent 描述
  "responsibilities": "...",      // 可选：核心职责
  "workflow": "...",              // 可选：工作流程
  "currentSoul": "..."            // 可选：当前 SOUL 内容（优化模式）
}
```

**响应**:
```json
{
  "success": true,
  "soul": "# Agent · SOUL\n\n..."
}
```

## 常见问题

### Q: 为什么点击 AI 润色没有反应？

A: 检查以下几点：
1. 是否配置了 `AI_API_KEY` 或 `OPENAI_API_KEY`
2. 是否重启了应用
3. 打开浏览器控制台查看是否有错误信息
4. 检查网络连接和 API 服务是否可用

### Q: 可以使用国内的 AI 服务吗？

A: 可以，只要服务实现了 OpenAI 兼容接口。例如：
- 智谱 AI (ChatGLM): 配置对应的 API URL
- 百度文心一言: 使用兼容层或代理
- 阿里通义千问: 使用兼容层或代理

### Q: 生成的内容不满意怎么办？

A: 可以采取以下措施：
1. 提供更详细的职责和流程描述
2. 在生成后手动编辑优化
3. 多次生成选择最好的版本
4. 调整 `.env` 中的 `AI_MODEL` 使用更强的模型

### Q: AI 润色会消耗多少 Token？

A: 典型场景下：
- 系统提示词: ~200 tokens
- 用户输入: ~100-500 tokens
- 生成内容: ~500-1000 tokens
- 总计: ~800-1700 tokens/次

使用 `gpt-4o-mini` 成本很低，每次润色约 $0.001-0.003 美元。

## 技术实现

- **后端 API**: `app/api/agents/polish/route.ts`
- **前端组件**: `app/agents/page.tsx` (CreateAgentModal, MantaDetailPanel, ExternalDetailPanel)
- **API 调用**: 使用标准 Fetch API 调用 OpenAI 兼容接口
- **错误处理**: 完整的错误捕获和用户友好提示

## 安全建议

1. **不要提交 API Key**: `.env` 文件已在 `.gitignore` 中，不会被提交到 Git
2. **使用环境隔离**: 生产环境和开发环境使用不同的 API Key
3. **限制 Token 用量**: 在 AI 服务商后台设置用量限制
4. **定期轮换密钥**: 定期更换 API Key 提高安全性

## 未来计划

- [ ] 支持多轮对话式优化
- [ ] 支持从现有 Agent 中学习风格
- [ ] 支持批量生成和优化
- [ ] 支持自定义提示词模板
- [ ] 支持本地模型（无需 API Key）
