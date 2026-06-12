# AI 润色功能测试指南

## 快速测试

### 1. 配置测试环境

创建 `.env.local` 文件（或编辑 `.env`）：

```bash
# 使用 OpenAI 官方接口测试
OPENAI_API_KEY=<your-test-key>
OPENAI_MODEL=gpt-4o-mini
```

### 2. 启动应用

```bash
npm run dev
```

访问 http://localhost:3000/agents

### 3. 测试新建 Agent

1. 点击右上角「+ 新建」按钮
2. 填写测试数据：
   - **名称**: `code-reviewer`
   - **描述**: `自动化代码审查助手`
   - **核心职责**: `负责代码质量检查、安全漏洞扫描、最佳实践建议`
   - **工作流程**: `1. 接收代码变更 2. 运行静态分析工具 3. 生成审查报告 4. 提供改进建议`

3. 点击「✨ AI 生成 SOUL.md」按钮
4. 等待 2-5 秒，查看生成结果

**期望结果**:
```markdown
# Agent · SOUL

## 身份
你是一个专业的代码审查助手，专注于提升代码质量和团队开发规范。

## 职责
- 自动化代码质量检查
- 识别潜在安全漏洞
- 提供最佳实践建议
- 确保代码符合团队规范

## 工作流程
1. 接收开发者提交的代码变更
2. 运行静态分析工具进行全面扫描
3. 生成结构化的审查报告
4. 提供具体、可操作的改进建议
```

### 4. 测试编辑现有 Agent

**前置条件**: 已有一个 Manta Agent

1. 选择左侧列表中的 Manta Agent
2. 点击「编辑」按钮
3. 点击「✨ AI 润色」展开助手
4. 填写补充信息：
   - **补充职责**: `增加代码风格检查能力`
   - **补充流程**: `集成 ESLint 和 Prettier`
5. 点击「✨ AI 优化 SOUL.md」
6. 查看优化结果

### 5. 测试编辑外部 Agent（OpenClaw）

**前置条件**: 已有 OpenClaw agent 且标记为「可编辑」

1. 选择标记为「可编辑」的 OpenClaw Agent
2. 测试流程同 Manta Agent

## 错误场景测试

### 测试 1: 未配置 API Key

1. 确保 `.env` 中没有 API Key
2. 尝试点击 AI 润色按钮
3. **期望**: 显示错误提示「未配置 AI API Key」

### 测试 2: 无效的 API Key

1. 配置错误的 API Key: `OPENAI_API_KEY=sk-invalid-key`
2. 尝试点击 AI 润色按钮
3. **期望**: 显示错误提示「AI API 请求失败: 401」

### 测试 3: 网络错误

1. 配置错误的 Base URL: `OPENAI_BASE_URL=http://invalid-url`
2. 尝试点击 AI 润色按钮
3. **期望**: 显示错误提示「AI 润色失败: fetch failed」

### 测试 4: 空输入

1. 新建 Agent，不填写任何信息
2. 尝试点击 AI 润色按钮
3. **期望**: 按钮为禁用状态（灰色）

## 性能测试

### 测试响应时间

```bash
# 使用 curl 测试 API 响应时间
time curl -X POST http://localhost:3000/api/agents/polish \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-agent",
    "description": "测试 Agent",
    "responsibilities": "测试职责",
    "workflow": "测试流程"
  }'
```

**期望时间**:
- `gpt-4o-mini`: 2-5 秒
- `gpt-4o`: 5-10 秒

## 自动化测试脚本

创建 `scripts/test-ai-polish.ts`:

```typescript
// 测试 AI 润色 API
async function testPolish() {
  const response = await fetch('http://localhost:3000/api/agents/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test-agent',
      description: 'A test agent',
      responsibilities: 'Test responsibilities',
      workflow: 'Test workflow',
    }),
  })

  const data = await response.json()
  
  if (data.success) {
    console.log('✓ AI 润色成功')
    console.log('生成内容长度:', data.soul.length)
    console.log('预览:', data.soul.slice(0, 100) + '...')
  } else {
    console.error('✗ AI 润色失败:', data.error)
  }
}

testPolish()
```

运行测试:
```bash
npx tsx scripts/test-ai-polish.ts
```

## 检查清单

- [ ] 配置了有效的 API Key
- [ ] 应用已重启并正常运行
- [ ] 新建 Agent 的 AI 润色功能正常
- [ ] 编辑 Manta Agent 的 AI 润色功能正常
- [ ] 编辑 OpenClaw Agent 的 AI 润色功能正常
- [ ] 错误提示清晰友好
- [ ] 按钮禁用/启用状态正确
- [ ] 生成的内容格式正确
- [ ] 响应时间在可接受范围内

## 常见问题排查

### 问题 1: 点击按钮无反应

排查步骤：
1. 打开浏览器开发者工具 (F12)
2. 切换到 Console 标签
3. 点击 AI 润色按钮
4. 查看是否有错误信息

### 问题 2: 生成内容为空或格式错误

排查步骤：
1. 检查 API 返回的完整响应
2. 查看 `data.choices[0].message.content` 是否有值
3. 尝试更换模型（如 gpt-4o）

### 问题 3: 请求超时

排查步骤：
1. 检查网络连接
2. 尝试访问 API Base URL
3. 增加超时时间或更换模型

## 报告问题

如果发现 Bug，请提供以下信息：

1. **环境信息**:
   - Node.js 版本
   - 操作系统
   - 浏览器版本

2. **配置信息**:
   - API 服务商（OpenAI / Azure / 其他）
   - 使用的模型名称
   - Base URL（脱敏）

3. **错误信息**:
   - 浏览器控制台错误
   - 网络请求详情
   - 后端日志

4. **复现步骤**:
   - 详细的操作步骤
   - 输入的测试数据
