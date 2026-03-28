# Manta Architecture

> **定位**：Agent 调度操作系统 — 人类掌舵，Agent 执行，驱动可插拔
> **口号**：Humans steer. Agents execute. Drivers are pluggable.

---

## 1. 目录地图

```
arm-claw/
├── core/                     # 三层核心引擎（纯 TypeScript，无 UI 依赖）
│   ├── workflow-engine/      # 任务状态机 + 工作流编排
│   ├── runner/               # Agent CLI 执行层（插件化）
│   └── channel/              # 通知层（插件化）
├── registry/                 # Agent 注册表（名字 → CLI配置 + Skills）
├── app/                      # Next.js UI（纯消费层，不含业务逻辑）
│   ├── pages/                # 首页 / 看板 / 处理中心
│   ├── components/           # 可复用组件
│   └── styles/               # 全局样式 + 主题变量
├── plugins/                  # Runner/Channel 社区插件目录
├── docs/                     # 知识库（这个文件就在这里）
├── electron/                 # Electron 主进程
├── workflows/                # 工作流 YAML 模板
└── theme.config.json         # 主题配置（颜色/字体/圆角）
```

---

## 2. 核心三层

### 2.1 Workflow Engine — `core/workflow-engine/`

任务的大脑。负责：
- 任务状态机：`inbox → planning → running → done / failed / archived`
- 工作流编排：sequential / parallel / conditional / loop / cron
- 工作流互调：工作流可以嵌套调用其他工作流
- Human-in-loop：关键节点等待人工审批
- 数据存储：`~/arm-data/` JSON 文件（启动时读取）

**入口**：`core/workflow-engine/index.ts`

### 2.2 Runner — `core/runner/`

任务的手。负责调用 Agent CLI，获取执行结果。

**内置 Runner**：
- `openclaw` — openclaw CLI
- `claude-code` — claude code CLI
- `generic-cli` — 通用 CLI（用户自定义命令）

**Runner 接口**（所有 Runner 必须实现）：
```typescript
interface Runner {
  id: string
  probe(): Promise<{ available: boolean; reason?: string }>
  run(params: RunParams): Promise<RunResult>
}
```

**入口**：`core/runner/index.ts`

### 2.3 Channel — `core/channel/`

任务的嘴。负责向用户发送通知。

**内置 Channel**：
- `mac-notification` — macOS 系统通知
- `webhook` — HTTP Webhook（飞书/Slack/企微/Discord）

**Channel 接口**：
```typescript
interface Channel {
  id: string
  send(message: ChannelMessage): Promise<void>
}
```

**入口**：`core/channel/index.ts`

---

## 3. Agent Registry — `registry/`

名字到执行配置的映射表。

```yaml
# registry/agents.yaml
agents:
  - name: openclaw
    runner: openclaw
    bin: ""           # 留空自动发现 PATH
    skills: []

  - name: claude
    runner: claude-code
    bin: claude
    skills: []
```

**入口**：`registry/index.ts`

---

## 4. 任务模式

| 模式 | 路径 | 说明 |
|---|---|---|
| 轻量模式 | Task → Runner → 结果 | 直接指定 Agent，无工作流 |
| 完整模式 | Task → Workflow → Runner | 多步骤编排，支持 human-in-loop |

---

## 5. 数据流

```
用户输入任务
    ↓
Workflow Engine（状态机）
    ↓               ↓
Runner（执行CLI）   Channel（发通知）
    ↓
Agent Registry（查找配置）
    ↓
本地 CLI 进程
    ↓
结果写入 ~/arm-data/tasks/{id}/
```

---

## 6. 主题系统

`theme.config.json` 配置驱动，CSS 变量注入。
见 `app/styles/globals.css`，所有颜色使用 `var(--color-*)` 变量。

---

## 7. 层依赖规则

```
core/ → 不依赖 app/（单向）
app/ → 消费 core/（单向）
registry/ → 不依赖 core/（注册表独立）
core/ → 可依赖 registry/
plugins/ → 实现 core/ 定义的接口
```

违反以上规则的 PR 不予合并。

---

> 这是 Agent 的地图，不是手册。保持 ≤200 行。
