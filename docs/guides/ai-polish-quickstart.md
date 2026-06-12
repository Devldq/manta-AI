# AI 润色功能 - 快速开始

## 1️⃣ 零配置使用（推荐）✨

**使用本地 OpenClaw，无需任何配置！**

### 前提条件

确保已安装 OpenClaw CLI：

```bash
# macOS
brew install openclaw

# 或检查是否已安装
openclaw --version
```

### 开始使用

直接使用，无需配置！系统会自动：
1. 检测 OpenClaw CLI
2. 创建 `polish-helper` Agent
3. 执行 AI 润色

---

## 2️⃣ 使用外部 API（可选）

如果想使用更快或更强的外部模型，可以配置：

在项目根目录创建 `.env` 文件：

```bash
AI_API_KEY=<your-api-key>
AI_MODEL=gpt-4o-mini
```

**自动降级策略**：
- 有外部 API Key → 使用外部 API
- 无外部 API Key → 自动使用 OpenClaw
- 对用户完全透明！

---

## 2️⃣ 启动（10 秒）

```bash
npm run dev
```

访问 http://localhost:3000/agents

## 3️⃣ 使用（3 分钟）

### 新建 Agent

1. 点击「+ 新建」
2. 填写名称和描述
3. 在「✨ AI 润色助手」填写职责和流程
4. 点击「✨ AI 生成 SOUL.md」
5. 审阅生成的内容
6. 点击「创建并注入」

**完成！** 🎉

### 编辑现有 Agent

1. 选择一个 Agent
2. 点击「编辑」
3. 点击「✨ AI 润色」
4. 补充信息后点击「✨ AI 优化 SOUL.md」
5. 审阅并保存

**完成！** 🎉

---

## 📝 示例

### 示例 1: 代码审查 Agent

**输入**:
```
名称: code-reviewer
描述: 专业代码审查助手
职责: 代码质量检查、安全漏洞扫描、最佳实践建议
流程: 接收变更 → 分析 → 生成报告 → 提供建议
```

**输出**:
```markdown
# Agent · SOUL

## 身份
你是一个专业的代码审查助手，专注于提升代码质量...

## 职责
- 自动化代码质量检查
- 识别潜在安全漏洞
...

## 工作流程
1. 接收开发者提交的代码变更
2. 运行静态分析工具进行全面扫描
...
```

### 示例 2: 文档生成 Agent

**输入**:
```
名称: doc-generator
描述: 自动化文档生成工具
职责: 从代码注释生成文档、维护 API 文档、生成变更日志
流程: 扫描代码 → 提取注释 → 生成 Markdown → 发布
```

**输出** → 完整的 SOUL.md 文档

---

## ❓ 常见问题

**Q: 必须配置 OpenAI API Key 吗？**
A: 是的，但支持任何 OpenAI 兼容服务，包括 Azure、本地模型等。

**Q: 费用大概多少？**
A: 使用 gpt-4o-mini，每次约 $0.001-0.003，非常便宜。

**Q: 生成的内容可以修改吗？**
A: 完全可以！生成后可以自由编辑，保存即可。

**Q: 如果生成的内容不满意？**
A: 可以补充更多信息后重新生成，或者直接手动编辑。

---

## 📚 更多文档

- [详细使用指南](./ai-polish-guide.md)
- [测试指南](./ai-polish-testing.md)
- [功能总结](./ai-polish-summary.md)
- [演示脚本](./ai-polish-demo-script.md)

---

**开始使用 AI 润色，让 Agent 创建更简单！** ✨
