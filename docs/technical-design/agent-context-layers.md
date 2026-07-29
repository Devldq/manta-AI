# Agent 上下文六层结构

模型调用统一由五层固定上下文和一层动态 Messages 组成。

## 固定层

固定层在 Conversation 首次执行时建立快照；同一 Conversation 的后续用户回合和 Agent Step 复用同一个快照。

1. **System Instructions**：平台规则、工具真实性和安全规则。
2. **Core Tools**：高频文件、搜索、Shell 工具，以及固定的 `tool_search`、`tool_invoke`、`skill_search`。
3. **Environment**：cwd、OS、Shell、Git 分支和 Runtime Security Facts。
4. **Capability Catalog**：低频内置工具、MCP 工具和 Skills 的名称与一句话描述，不展开正文或 Schema。
5. **Project Context**：`AGENTS.md`、Agent Soul、Memory Index 和 Conversation 标识。

Agent、cwd 或 Runtime Security Facts 变化时创建新的 Context Epoch。Service 重启后会为恢复的 Conversation 重建一次快照。

## 动态层

第六层 Messages 包含：

- 用户与 Agent 消息；
- 当前用户回合的 Intent/Plan；
- 运行时循环提醒；
- `tool_search` 返回的完整工具 Schema；
- `skill_search` 返回的 Skill 正文；
- `tool_invoke` 和核心工具的调用参数与结果；
- Compaction Summary。

Messages 依次经过 Microcompact、单条/总量截断、TTL 修剪和 LLM Compaction。

## 按需工具协议

```text
Capability Catalog
  -> tool_search(query)
  -> 完整 Schema 进入 Messages
  -> tool_invoke(toolName, arguments)
  -> 执行结果进入 Messages
```

MCP 在 Conversation 快照建立后完成连接时，`tool_search` 可以从最新 Registry 发现它；新 Schema 仍只进入 Messages，不修改固定 System Prompt 或 Core Tools。
