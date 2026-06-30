# Plugin 插件架构文档

## 概述

Manta Plugin 系统是一个模块化的 Agent 能力扩展机制。通过 plugin.yaml 清单文件声明插件的能力、钩子、依赖和权限，实现优雅的扩展管理模式。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Manta Plugin System                               │
├─────────────────────────────────────────────────────────────────────────┤
│  Frontend (React SPA)                                                    │
│  /plugins — Plugin 管理页面                                               │
│    • 安装/卸载/启禁用插件                                                  │
│    • 扫描 plugins/ 目录注册 plugin.yaml                                    │
│    • 查看插件详情（能力/钩子/依赖/权限）                                    │
│    • 插件生命周期管理（激活/停用/钩子执行）                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Backend (Fastify)                                                       │
│  /api/plugins — RESTful API（共 13 个端点）                               │
│  Plugin Registry — 运行时管理（生命周期/事件总线/依赖拓扑排序）            │
├─────────────────────────────────────────────────────────────────────────┤
│  Storage                                                                 │
│  {workspace}/.manta/plugins/{id}.json — 管理数据持久化                      │
│  plugins/{id}/plugin.yaml — 清单文件（YAML）                               │
│  plugins/{id}/agents/ — Agent 定义（可选）                                 │
│  plugins/{id}/skills/ — Skill 定义（可选）                                 │
│  plugins/{id}/hooks/ — 钩子脚本（可选）                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心概念

### 1. Plugin Manifest (plugin.yaml)

每个插件由一个 `plugin.yaml` 清单文件定义，包含以下部分：

```yaml
# ─── 基本信息 ───
id: example.my-plugin         # 唯一标识，小写字母+数字+点号+连字符
name: My Plugin               # 显示名称
version: 1.0.0                # 语义化版本
description: 这个插件提供示例 Agent 能力
author: Your Name
license: MIT
homepage: https://example.com
requires: ">= 2.0.0"          # Manta 核心版本要求

# ─── 能力声明 ───
capabilities:
  - type: agent               # 提供 Agent
    name: my-agent
    description: 示例 Agent
    entry: agents/my-agent.md
  - type: skill               # 提供 Skill
    name: my-skill
    description: 示例 Skill
  - type: command             # 提供斜杠命令
    name: /my-command
    description: 执行自定义命令
  - type: tool                # 提供工具
    name: my-tool
    description: 自定义工具
  - type: mcp-server          # 提供 MCP 服务器
    name: my-mcp
    description: 自定义 MCP 服务器

# ─── 生命周期钩子 ───
hooks:
  - name: setup-env
    event: post-install
    command: node hooks/setup.js
    timeout: 30000
    blocking: true
  - name: cleanup
    event: pre-uninstall
    command: node hooks/cleanup.js
  - name: on-start
    event: on-enable
    command: echo "Plugin activated"

# ─── 依赖声明 ───
dependencies:
  - pluginId: core-utils       # 必需依赖
    version: ">= 1.0.0"
    required: true
  - pluginId: optional-lib     # 可选依赖
    version: "^2.0.0"
    required: false

# ─── 权限声明 ───
permissions:
  - type: network
    scope: api.example.com
    action: read
  - type: filesystem
    scope: ~/.manta-data/logs/
    action: write
  - type: env
    scope: API_KEY_*
    action: read
```

### 2. 插件能力类型

| 能力类型 | 说明 | 示例 |
|---------|------|------|
| `agent` | 提供 Agent 定义 | Claude Code Runner Agent |
| `skill` | 提供 Skill 技能 | 代码审查流水线 Skill |
| `mcp-server` | 提供 MCP 服务器 | 文件系统 MCP Server |
| `command` | 提供斜杠命令 | `/deploy` 部署命令 |
| `hook` | 提供生命周期钩子 | Pre-tool-use 安全拦截 |
| `tool` | 提供工具函数 | 自定义 Web 搜索工具 |
| `ui` | 提供 UI 扩展 | 自定义 Dashboard 面板 |

### 3. 生命周期事件

```
discovered → installed → active → (upgrading) → error

Lifecycle Events:
  pre-install    → 安装前验证
  post-install   → 安装后初始化
  pre-uninstall  → 卸载前清理
  post-uninstall → 卸载后通知
  on-enable      → 激活时加载
  on-disable     → 停用时释放
  on-upgrade     → 升级时迁移
  pre-agent-run  → Agent 执行前
  post-agent-run → Agent 执行后
```

### 4. 权限模型

| 权限类型 | 范围格式 | 操作 |
|---------|---------|------|
| `network` | 域名或 IP 范围 | read |
| `filesystem` | 目录路径（支持 glob） | read / write / execute |
| `process` | 进程名 | execute |
| `env` | 环境变量名（支持通配符） | read |

## 存储结构

```
项目根目录/
├── plugins/                          # 插件源文件目录
│   ├── _disabled.json                # 禁用列表
│   ├── example-plugin/               # 插件目录
│   │   ├── plugin.yaml               # 清单文件
│   │   ├── agents/                   # Agent 定义
│   │   ├── skills/                   # Skill 定义
│   │   └── hooks/                    # 钩子脚本
│   └── another-plugin/
│       └── plugin.yaml
│
├── .manta/
│   └── plugins/                      # 插件管理数据
│       ├── plugin-xxxx.json           # 插件1 持久化状态
│       └── plugin-yyyy.json           # 插件2 持久化状态
```

## API 接口文档

### Plugin CRUD

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/plugins` | 插件列表（支持 `?search=` 过滤） |
| GET | `/api/plugins/:id` | 插件详情 |
| PUT | `/api/plugins/:id` | 更新插件 |
| DELETE | `/api/plugins/:id` | 卸载插件（执行清理钩子） |

### Plugin 安装

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/plugins/install-file` | 从本地目录安装 `{ sourcePath: "..." }` |
| POST | `/api/plugins/install` | 简化安装（本地目录或 npm） |

### Plugin 生命周期

| 方法 | 端点 | 说明 |
|------|------|------|
| PATCH | `/api/plugins/:id/toggle` | 启禁用 `{ enabled: true/false }` |
| POST | `/api/plugins/:id/activate` | 激活插件 |
| POST | `/api/plugins/:id/deactivate` | 停用插件 |
| POST | `/api/plugins/:id/hooks/:event` | 手动执行指定事件的钩子 |

### Plugin 扫描 & 注册

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/plugins/scan` | 扫描 `plugins/` 目录 |
| POST | `/api/plugins/register` | 批量注册插件 `{ ids: [...] }` |
| GET | `/api/plugins/registry` | 注册表摘要信息 |

## 注册表运行时

Plugin Registry 是一个运行时单例，管理所有已注册插件的生命周期：

- **事件总线（EventBus）**: 插件间通信，发布/订阅模式
  - 事件: `plugin:installed`, `plugin:activated`, `plugin:deactivated`, `plugin:upgraded`
- **钩子执行**: 自动执行 lifecycle hooks，阻塞性钩子失败会中断操作
- **依赖管理**: 拓扑排序确定加载顺序，检测循环依赖
- **统计信息**: 记录钩子执行成功/失败次数

## 设计原则

1. **清单驱动**: 通过 plugin.yaml 声明式定义，约定优于配置
2. **安全优先**: 权限声明 + 最小权限原则，凭证隔离
3. **生命周期完整**: 安装→激活→升级→停用→卸载，全链路钩子支持
4. **渐进式复杂度**: 简单插件只需几行 YAML，复杂插件可以声明完整能力
5. **解耦设计**: 插件与核心通过接口隔离，互不影响

## 文件变更清单

### 类型系统 (shared)
- `packages/shared/src/types.ts` — 扩展 Plugin 完整类型体系
- `packages/shared/src/api-schemas.ts` — 新增 Plugin Zod schemas

### 后端
- `packages/backend/src/core/storage/plugin/store.ts` — Plugin 存储层
- `packages/backend/src/core/storage/plugin/scanner.ts` — Plugin 文件扫描器
- `packages/backend/src/core/storage/plugin/registry.ts` — Plugin 运行时注册表
- `packages/backend/src/routes/plugins.ts` — Plugin RESTful API（13 端点）

### 前端
- `packages/frontend/src/pages/plugins/page.tsx` — Plugin 管理全功能页面
- `packages/frontend/src/App.tsx` — 新增 `/plugins` 路由
- `packages/frontend/src/components/sidebar/SidebarNavItems.tsx` — 新增侧边栏入口
