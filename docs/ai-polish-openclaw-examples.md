# OpenClaw AI 润色 - 使用示例

## 场景 1: 零配置使用（最常见）

### 前提条件
```bash
# 确保 OpenClaw 已安装
openclaw --version
# 输出: openclaw version 1.0.0
```

### 操作步骤

1. **打开新建 Agent 弹窗**
   - 访问 http://localhost:3000/agents
   - 点击右上角「+ 新建」按钮

2. **填写基本信息**
   ```
   名称: code-reviewer
   描述: 自动化代码审查助手
   ```

3. **填写 AI 润色助手**
   ```
   核心职责:
   - 代码质量检查
   - 安全漏洞扫描
   - 最佳实践建议
   - 代码规范检查
   
   工作流程:
   1. 接收代码变更
   2. 运行静态分析工具
   3. 生成审查报告
   4. 提供改进建议
   ```

4. **点击「✨ AI 生成 SOUL.md」**
   - 按钮变为「✨ AI 生成中...」
   - 等待 3-10 秒
   - 自动使用 OpenClaw CLI 生成

5. **查看生成结果**
   ```markdown
   # Agent · SOUL
   
   ## 身份
   你是一个专业的代码审查助手，致力于通过自动化分析提升代码质量...
   
   ## 职责
   - 自动化代码质量检查：运行 ESLint、Prettier 等工具
   - 识别潜在安全漏洞：检测 SQL 注入、XSS 等常见漏洞
   ...
   
   ## 工作流程
   1. 接收开发者提交的代码变更请求
   2. 并行运行多个静态分析工具进行全面扫描
   ...
   ```

6. **保存 Agent**
   - 审阅生成的内容
   - 可以继续手动编辑
   - 点击「创建并注入」

**完成！** 🎉

---

## 场景 2: 使用外部 API（更快速度）

### 配置外部 API

创建 `.env` 文件：
```bash
AI_API_KEY=<your-api-key>
AI_MODEL=gpt-4o-mini
```

重启应用：
```bash
npm run dev
```

### 使用体验

- **优先使用外部 API**：速度更快（2-3 秒）
- **自动降级**：如果外部 API 失败，自动切换到 OpenClaw
- **完全透明**：用户无感知切换

---

## 场景 3: 编辑现有 Agent

### 优化 Manta Agent

1. 在左侧列表选择一个 Manta Agent
2. 点击「编辑」按钮
3. 点击「✨ AI 润色」展开助手
4. 填写补充信息：
   ```
   补充职责: 增加代码覆盖率检查
   补充流程: 集成到 CI/CD 流程
   ```
5. 点击「✨ AI 优化 SOUL.md」
6. 等待优化完成
7. 审阅并保存

---

## 首次使用时发生了什么？

### 自动初始化流程

1. **检测 OpenClaw**
   ```bash
   # 系统自动执行
   openclaw --version
   ```

2. **创建 polish-helper Agent**
   ```
   创建目录: ~/.openclaw/workspace-polish-helper/
   写入文件: ~/.openclaw/workspace-polish-helper/SOUL.md
   ```

3. **注册到 OpenClaw**
   ```json
   // 更新 ~/.openclaw/openclaw.json
   {
     "agents": {
       "list": [
         {
           "id": "polish-helper",
           "name": "Polish Helper",
           "workspace": "~/.openclaw/workspace-polish-helper"
         }
       ]
     }
   }
   ```

4. **执行润色**
   ```bash
   openclaw agent --agent polish-helper --message "用户输入的信息..."
   ```

**全自动，无需人工干预！**

---

## 查看 polish-helper Agent

创建后，你可以直接使用这个 Agent：

```bash
# 查看 SOUL.md
cat ~/.openclaw/workspace-polish-helper/SOUL.md

# 手动执行测试
openclaw agent --agent polish-helper --message "Agent名称: test-agent, 描述: 测试Agent"
```

---

## 常见问题

### Q: OpenClaw 版本要求？

A: 任何支持 `openclaw agent` 命令的版本即可。

### Q: polish-helper Agent 会消耗我的 Token 吗？

A: 是的，它使用你在 OpenClaw 中配置的模型和 API Key。如果你的 OpenClaw 使用本地模型（如 Ollama），则完全免费。

### Q: 可以自定义 polish-helper 的 SOUL.md 吗？

A: 可以！编辑 `~/.openclaw/workspace-polish-helper/SOUL.md`，下次生成时就会使用你的自定义提示词。

### Q: 生成失败怎么办？

A: 系统会显示详细错误信息：
- `OpenClaw CLI 不可用` → 检查是否安装并在 PATH 中
- `OpenClaw 执行失败` → 查看 OpenClaw 的日志
- `返回内容为空` → 检查 OpenClaw 的模型配置

### Q: 可以删除 polish-helper Agent 吗？

A: 可以，但下次使用润色功能时会自动重新创建。建议保留。

---

## 性能对比

| 方案 | 响应时间 | Token 消耗 | 配置复杂度 | 推荐场景 |
|------|----------|-----------|-----------|---------|
| OpenClaw | 3-10秒 | 本地配额 | 零配置 | **日常使用** |
| 外部 API | 2-5秒 | 付费 | 简单配置 | 追求速度 |

---

## 调试技巧

### 启用详细日志

```bash
# 手动执行 OpenClaw 查看完整输出
openclaw agent --agent polish-helper --message "测试消息" --verbose

# 查看 Manta 后端日志
# 在终端查看 npm run dev 的输出
```

### 测试 API 端点

```bash
# 测试外部 API
curl -X POST http://localhost:3000/api/agents/polish \
  -H "Content-Type: application/json" \
  -d '{"name":"test","description":"测试"}'

# 测试 OpenClaw API
curl -X POST http://localhost:3000/api/agents/polish-openclaw \
  -H "Content-Type: application/json" \
  -d '{"name":"test","description":"测试"}'
```

---

## 高级使用

### 自定义润色提示词

编辑 `~/.openclaw/workspace-polish-helper/SOUL.md`：

```markdown
# Agent · SOUL

## 身份
你是一个资深的 Agent 架构师，专注于企业级 Agent 设计。

## 职责
生成符合企业标准的 SOUL.md 文档，注重：
- 安全性和合规性
- 可维护性和可扩展性
- 团队协作友好

## 工作流程
1. 分析业务需求和技术栈
2. 设计 Agent 架构和交互流程
3. 生成结构化的 SOUL.md
4. 添加最佳实践和注意事项

## 输出格式
Markdown 格式，包含完整的元数据和示例。
```

### 批量生成测试

```bash
# 创建测试脚本
cat > test-polish.sh << 'EOF'
#!/bin/bash
for name in agent-1 agent-2 agent-3; do
  curl -s -X POST http://localhost:3000/api/agents/polish-openclaw \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"description\":\"Test agent $name\"}" \
    | jq -r '.soul' > "${name}.md"
  echo "Generated ${name}.md"
done
EOF

chmod +x test-polish.sh
./test-polish.sh
```

---

**享受零配置的 AI 润色体验！** ✨
