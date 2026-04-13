# 女娲 Agent 使用指南

## 🌟 简介

**女娲（Nüwa）** 是一个元级 AI Agent，专门用于创造和设计其他 Agent。

如同神话中的女娲造人，这个 Agent 的使命是理解需求、设计架构、赋予灵魂，创造出高质量、专业化的 AI Agent。

## 📦 已创建内容

✅ **Manta 元数据**
- 位置: `~/manta-data/agents/nuwa/agent.json`
- 包含: 名称、描述、创建时间

✅ **OpenClaw Agent**
- Workspace: `~/.openclaw/workspace-nuwa/`
- SOUL.md: 完整的 Agent 定义文档（6.6 KB）
- 状态: 已注入并可用

✅ **在 Manta 界面中可见**
- 访问: http://localhost:3000/agents
- 分区: Manta（托管 Agent）
- 支持: 查看、编辑、删除

## 🚀 快速使用

### 方式 1: 命令行直接调用

```bash
# 基础用法
openclaw agent --agent nuwa --message "请帮我创建一个代码审查 Agent"

# 详细描述
openclaw agent --agent nuwa --message "
请帮我创建一个前端性能分析 Agent。
它需要能够分析网页加载速度、识别性能瓶颈、提供优化建议。
主要关注 React 应用的性能优化。
"
```

### 方式 2: 通过 Manta 界面

1. 访问 http://localhost:3000/agents
2. 在左侧 "Manta" 分区找到 "nuwa"
3. 点击查看详细信息
4. 查看完整的 SOUL.md 文档
5. 如需修改，点击"编辑"按钮

### 方式 3: 在工作流中使用

创建工作流文件 `workflows/create-agent.yml`:

```yaml
id: create-agent
name: 创建新 Agent
description: 使用女娲创建新的 Agent

steps:
  - id: design
    type: agent
    agent: nuwa
    prompt: |
      请帮我设计一个 {{agent_name}} Agent。
      核心功能：{{core_features}}
      目标用户：{{target_users}}
```

## 💡 使用示例

### 示例 1: 创建代码审查 Agent

**输入**：
```
openclaw agent --agent nuwa --message "
请帮我创建一个代码审查 Agent。
职责：
- 自动检查代码质量
- 发现安全漏洞
- 提供改进建议
- 确保符合团队规范
"
```

**输出**：
女娲会生成一份完整的 SOUL.md，包含：
- 清晰的身份定位
- 结构化的职责清单
- 详细的工作流程
- 输入输出规范
- 限制和注意事项

### 示例 2: 创建数据分析 Agent

**输入**：
```bash
openclaw agent --agent nuwa --message "
创建一个数据分析 Agent，用于分析用户行为数据。
需要能够：
1. 从数据库提取数据
2. 进行统计分析
3. 生成可视化报告
4. 发现异常模式
"
```

### 示例 3: 批量创建相关 Agent

```bash
# 创建一系列前端开发相关的 Agent
for role in "代码生成" "测试编写" "文档生成"; do
  openclaw agent --agent nuwa --message "
    创建一个前端${role} Agent
  " > "agent-${role}.md"
done
```

## 🎯 女娲的核心能力

### 1. 需求理解
- 深入分析 Agent 需求
- 识别核心目标和隐含需求
- 评估可行性和复杂度

### 2. 架构设计
- 身份定位：清晰的角色设计
- 职责规划：结构化职责清单
- 流程设计：可执行的工作流程
- 接口定义：明确的输入输出

### 3. 文档生成
- 完整的 SOUL.md 结构
- 清晰、专业的表达
- 具体的示例和最佳实践
- 可读性和可执行性

### 4. 质量保证
- 自我审阅和优化
- 应用最佳实践
- 持续迭代改进

## 📋 输出格式

女娲生成的 SOUL.md 包含以下标准章节：

```markdown
# Agent · SOUL

## 身份
[角色定位、专业领域、性格特征]

## 职责
[结构化职责清单，每项包含具体任务]

## 工作流程
[详细的执行步骤，包含输入、处理、输出]

## 输入输出
[明确的接口定义和数据格式]

## 限制和注意事项
[能力边界、约束条件、风险提示]

## 示例场景（可选）
[典型使用场景和预期行为]
```

## 🔧 高级用法

### 优化现有 Agent

```bash
openclaw agent --agent nuwa --message "
当前有一个代码审查 Agent，但它的 SOUL.md 不够完善。
请帮我优化改进：

当前 SOUL.md：
[粘贴现有内容]

改进方向：
- 增加自动化能力
- 支持多种编程语言
- 集成 CI/CD 流程
"
```

### 创建 Agent 系列

```bash
openclaw agent --agent nuwa --message "
我需要创建一套前端开发的 Agent 体系：
1. 架构设计 Agent
2. 代码实现 Agent
3. 测试验证 Agent
4. 部署发布 Agent

请先设计架构设计 Agent。
"
```

### 结合特定领域知识

```bash
openclaw agent --agent nuwa --message "
创建一个金融风控 Agent。
行业背景：需要符合银行监管要求
技术栈：Python + 机器学习
数据源：交易数据、用户行为数据
"
```

## 🎨 女娲的设计原则

### 1. 单一职责原则
每个 Agent 专注于一个核心领域，避免功能过于庞杂。

### 2. 清晰边界原则
明确 Agent 能做什么、不能做什么。

### 3. 可执行性原则
生成的 SOUL.md 足够具体，能够直接指导 Agent 行为。

### 4. 用户友好原则
使用清晰、自然的语言，避免过度技术化。

### 5. 迭代改进原则
接受 Agent 设计是一个渐进的过程，支持持续优化。

## 📊 典型应用场景

### 场景 1: 快速原型验证
有新想法需要快速验证 → 使用女娲生成初版 Agent → 快速迭代

### 场景 2: 团队标准化建设
需要统一 Agent 设计规范 → 通过女娲确保一致的结构和质量

### 场景 3: 知识传承
资深设计师经验固化 → 将设计模式融入女娲

### 场景 4: 批量创建
创建一系列相关 Agent → 女娲高效生成，确保协同性

## 🛠️ 管理女娲 Agent

### 查看详情
```bash
# 查看 Manta 元数据
cat ~/manta-data/agents/nuwa/agent.json | jq .

# 查看完整 SOUL.md
cat ~/.openclaw/workspace-nuwa/SOUL.md

# 在浏览器中查看
open http://localhost:3000/agents
```

### 编辑 SOUL.md
```bash
# 方式 1: 命令行编辑
vim ~/.openclaw/workspace-nuwa/SOUL.md

# 方式 2: 通过 Manta 界面编辑
# 访问 http://localhost:3000/agents
# 选择 nuwa → 点击"编辑" → 修改内容 → 保存
```

### 删除 Agent
```bash
# 通过 API 删除
curl -X DELETE http://localhost:3000/api/agents/manta/nuwa

# 手动删除文件
rm -rf ~/manta-data/agents/nuwa
rm -rf ~/.openclaw/workspace-nuwa
```

## 💪 女娲的特殊能力

作为元级 Agent，女娲具备：

1. **模式识别**：识别常见的 Agent 设计模式
2. **质量评估**：评估生成的 SOUL.md 质量
3. **最佳实践**：应用行业最佳实践
4. **创新设计**：提供创新的设计方案
5. **知识整合**：整合多领域知识

## 🔍 故障排查

### 问题 1: Agent 调用失败
```bash
# 检查 Agent 是否注册
openclaw config get agents.list | grep nuwa

# 重新注入
curl -X POST http://localhost:3000/api/agents/inject
```

### 问题 2: 生成内容不符合预期
- 提供更详细的描述
- 明确具体的职责和流程
- 提供参考示例
- 多次迭代优化

### 问题 3: SOUL.md 丢失
```bash
# 重新从 Manta 注入
curl -X POST http://localhost:3000/api/agents/inject
```

## 📚 相关资源

- **Manta Agent 管理界面**: http://localhost:3000/agents
- **OpenClaw 配置**: ~/.openclaw/openclaw.json
- **女娲 Workspace**: ~/.openclaw/workspace-nuwa/
- **Manta 数据目录**: ~/manta-data/agents/nuwa/

## 🎓 最佳实践

### 提供清晰的需求
```
❌ 差：创建一个 Agent
✅ 好：创建一个前端代码审查 Agent，负责检查 React 代码质量
```

### 描述具体的职责
```
❌ 差：帮助开发
✅ 好：1. 自动检测代码问题 2. 提供修复建议 3. 生成审查报告
```

### 说明工作流程
```
❌ 差：处理代码
✅ 好：接收代码 → 运行 ESLint → 分析结果 → 生成报告 → 提供建议
```

## 🌈 持续进化

女娲会通过以下方式持续提升：
- 学习优秀 Agent 的设计模式
- 收集用户反馈并改进生成质量
- 跟踪 AI Agent 领域的最新实践
- 优化自身的设计方法论

---

**女娲已就位，随时为你创造出色的 AI Agent！** 🌟

需要创建新的 Agent？直接告诉女娲你的想法！
