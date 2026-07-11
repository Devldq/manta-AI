# Manta ASH（Agent Storage Hub）技术设计

**状态：** 待用户评审

**日期：** 2026-07-11

**产品：** Manta AI

**概念名称：** ASH（Agent Storage Hub）

**产品口号：** 一份能力，所有 Agent。 / One Library. Every Agent.

## 1. 摘要

Manta AI 将从以通用对话为中心的 Agent，调整为以本地 Agent 资产管理为中心的 Agent Storage Hub。基础对话能力继续保留，但主要用于验证知识库、Skill、Plugin 和配置是否可用，不再承担产品的主要差异化定位。

ASH 统一管理 Manta 自身以及未来外部 Agent 使用的本地持久化资产，包括知识库、RAG 数据、Skills、Plugins、Plugin Marketplace、工作数据、应用配置、凭据、日志和缓存。用户可以：

1. 首次安装时选择数据保存位置；实际数据目录固定命名为 `.manta-ai`。
2. 将多个逻辑存储组组合为一个用户定义的存储卷。
3. 为不同存储卷选择不同的本机、iCloud、同步盘或挂载目录。
4. 在线迁移整个存储卷，或把一个存储组迁移到其他卷。
5. 为每个存储卷绑定至多一个 Git 仓库；一个仓库同步卷中的所有有效持久化数据。
6. 查看卷和存储组的容量、文件数量、同步状态、迁移状态、可清理空间和去重收益。
7. 将同一份逻辑资产投影给 Codex、Claude Code、WorkBee 等外部 Agent；第一版适配接口先以 Codex 验证。

ASH 不在本阶段实现通用 Agent Harness。模型执行循环、沙箱、任务编排、重试和多 Agent 调度仍由 Manta 现有 Runtime 或外部 Agent 自己负责。

## 2. 已确认的产品决策

| 决策 | 结论 |
|---|---|
| 产品名称 | 继续使用 Manta AI；“Meta AI”为笔误 |
| 核心概念 | Agent Storage Hub，简称 ASH |
| 数据目录名称 | 用户选择父目录，实际使用其下的 `.manta-ai` |
| 首次启动 | 必须完成数据位置初始化，不能跳过，可以退出应用 |
| 在线修改位置 | 自动迁移、校验、保留备份，并立即重启应用 |
| 持久化边界 | 应用内部持久化全部归一；用户或 Agent 明确指定的输出路径保持原路径 |
| 扩展能力 | Skills、Plugins、Plugin Marketplace 属于一个不可拆分的存储组 |
| 知识检索 | 原始文档、解析数据、本地 SQL/SQLite、Vector DB、Embedding 属于一个存储组 |
| 物理组织 | 多个存储组可组合到一个存储卷；一个存储组只属于一个卷 |
| Git | 一个存储卷最多绑定一个 Git 仓库；不是每个存储组一个仓库 |
| iCloud | 作为普通文件夹位置使用，由 Apple 负责同步，ASH 不模拟 iCloud 协议 |
| 简单模式 | 默认一个卷包含全部存储组；用户只需选择一个目录，可选绑定一个 Git 仓库 |
| 高级模式 | 用户可创建多个卷，按隐私、容量、速度和仓库权限重新组合存储组 |
| Harness | 暂不建设；ASH 聚焦存储、同步、资产和 Agent 适配 |
| 历史用户 | 项目尚在开发，不维护正式旧版本兼容矩阵；现有 `.manta-data` 仅作为开发数据导入来源 |

## 3. 目标与非目标

### 3.1 目标

- 所有 Manta 内部持久化数据都通过 ASH 路由，不再由业务模块自行拼接路径。
- 所有运行时安装或生成的 Skill、Plugin 和 Marketplace 内容离开仓库 `.manta`，进入用户卷的 `extensions` 组。
- 首次安装和运行中迁移均具有断电恢复、失败回滚和源数据备份能力。
- 存储组和存储卷成为容量统计、迁移、同步、权限与未来 Agent 适配的稳定边界。
- Git 和文件夹同步对普通用户保持简单：卷选择目录，卷可选绑定 Git。
- 对文档、Skill 包和 Plugin 包进行真实的内容去重，并准确展示节省空间，避免营销口号超出实际能力。
- 保留未来拆出独立 ASH 服务的包边界，不让核心逻辑依赖 Electron UI。

### 3.2 非目标

- 不实现新的通用 Agent Harness。
- 不替代 Codex、Claude Code 或 WorkBee 的执行循环、权限系统和沙箱。
- 不把 Agent 文件工具写入的项目源码、报告、导出文件或用户明确指定目录强制重定向到 `.manta-ai`。
- 不在第一版支持一个卷绑定多个 Git 仓库、多个远端策略或复杂团队 ACL。
- 不实现 iCloud、OneDrive 或 Dropbox 的网络同步协议；ASH 只安全使用它们暴露的本地文件夹。
- 不承诺把实时写入中的数据库文件直接交给 Git 或云盘；数据库通过 checkpoint 和一致性快照参与同步。

## 4. 分阶段交付

本设计描述完整 ASH 架构，但实现必须拆成可独立验证的阶段，每个阶段单独编写实施计划。

### 阶段 1：存储基础与安全迁移

- 新建 `@manta/storage-hub` 核心包。
- 建立存储组、存储卷、Bootstrap、路径路由和生命周期接口。
- 完成全部应用内部文件 I/O 审计并移除 `.manta-data`、仓库 `.manta` 等运行时硬编码。
- 将前端持久化的 `localStorage`/IndexedDB 数据迁到 ASH 的 `config` 或 `cache` 组。
- 实现首次启动必选向导。
- 实现设置页“存储”Tab、容量统计、创建卷、迁移卷、移动存储组、备份与重启恢复。

### 阶段 2：存储卷 Git 与云目录可靠性

- 每个卷可绑定一个本地或远端 Git 仓库。
- 实现一致性快照、fetch、冲突检测、事务式导入、commit 和 push。
- 实现 iCloud/OneDrive/Dropbox 文件夹识别、离线状态和冲突副本提示。
- 支持手动、启动时和定时 Git 同步。

### 阶段 3：内容寻址、去重与空间洞察

- 对原始文档、Skill 包、Plugin 包建立内容寻址对象库。
- 支持同卷内去重、引用计数、垃圾回收和安全清理。
- 展示逻辑大小、实际物理占用、同步副本、可清理空间和真实去重收益。

### 阶段 4：外部 Agent 适配

- 提供稳定的 `AgentAdapter` 接口。
- 首个实现 Codex 适配器，验证 Skills、Instructions 和 MCP 配置的导入、预览和投影。
- 后续按相同接口增加 Claude Code、WorkBee 和其他 Agent。

## 5. 核心架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Manta Frontend                                               │
│ 首次初始化 / 存储 Tab / 容量 / 迁移 / Git / Agent 接入      │
└───────────────────────┬──────────────────────────────────────┘
                        │ IPC + Local API
┌───────────────────────▼──────────────────────────────────────┐
│ Desktop Lifecycle Controller                                │
│ Bootstrap / 目录选择 / 后端启停 / 迁移维护态 / relaunch     │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│ @manta/storage-hub                                           │
│ Registry / Router / Inventory / Migration / Sync / CAS      │
└──────────────┬───────────────────┬───────────────────────────┘
               │                   │
┌──────────────▼──────────────┐  ┌─▼───────────────────────────┐
│ Manta Storage Group Drivers │  │ Agent Adapters              │
│ extensions/knowledge/...    │  │ Codex / future adapters     │
└──────────────┬──────────────┘  └─────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│ User-defined ASH Volumes                                    │
│ Local / iCloud folder / mounted folder + optional Git repo   │
└──────────────────────────────────────────────────────────────┘
```

### 5.1 包边界

新增包：

```text
packages/storage-hub/
├── src/domain/          # 类型、Schema、错误和不变量
├── src/bootstrap/       # Bootstrap 原子读取、写入与恢复
├── src/registry/        # 卷注册表和组归属
├── src/router/          # 逻辑路径解析与路径安全
├── src/inventory/       # 文件扫描、容量和哈希
├── src/migration/       # 事务、复制、校验、切换和回滚
├── src/sync/            # Git 快照与同步接口
├── src/content-store/   # 内容寻址和引用计数
└── src/adapters/        # 外部 Agent 适配契约
```

现有包职责调整：

- `packages/desktop`：只负责桌面生命周期和特权系统操作，不实现业务存储规则。
- `packages/backend`：注入 `StorageHub`，所有 Store 和 Route 通过其访问持久化路径。
- `packages/rag`：接收 knowledge 组路径，不再默认使用 `os.homedir()`。
- `packages/agent-sandbox`：接收 diagnostics 组路径，不再自行创建 `.manta-data`。
- `packages/frontend`：通过 API/IPC 管理 ASH，不在浏览器存储中保留应用级持久化事实。
- `packages/shared`：保存跨包 API Schema、存储组 ID 和响应类型。

`@manta/storage-hub` 必须是纯 Node/TypeScript 核心，不导入 React 或 Electron。Electron 能力通过接口注入。

## 6. 领域模型

### 6.1 存储组

系统定义七个稳定存储组。组 ID 是持久化协议的一部分，发布后不能随意更名。

| ID | 显示名称 | 内容 | 默认同步建议 |
|---|---|---|---|
| `extensions` | 扩展能力 | Skills、Plugins、Plugin Marketplace、安装包、安装和启用状态 | 适合同步 |
| `knowledge` | 知识与检索 | 原始文档、解析结果、知识库元数据、SQLite、Vector DB、Embedding | 适合同步，注意容量 |
| `work` | 工作数据 | 会话、任务、工作区配置、Apps、Workflows、Memory、任务内部产物 | 可同步，注意隐私 |
| `config` | 配置 | 主题、Webhook、LLM/MCP 非敏感配置、应用偏好 | 适合同步 |
| `secrets` | 凭据 | API Key、OAuth Token、敏感连接信息 | 默认不同步 |
| `diagnostics` | 运行与诊断 | 系统日志、会话日志、审计、进程状态、错误报告 | 默认本地 |
| `cache` | 缓存与临时数据 | 下载缓存、上传暂存、可重建索引、迁移和 Git 临时工作区 | 默认本地，可清理 |

`extensions` 内的 Skills、Plugins 和 Plugin Marketplace 不能被分配到不同卷。`knowledge` 内的原始文档和数据库也作为一个管理组迁移，但同步实现可对数据库生成一致性快照。

### 6.2 存储卷

存储卷是用户可创建和命名的物理容器，也是 Git、权限和迁移边界。

```ts
export type StorageGroupId =
  | 'extensions'
  | 'knowledge'
  | 'work'
  | 'config'
  | 'secrets'
  | 'diagnostics'
  | 'cache'

export interface StorageVolumeRecord {
  id: string
  name: string
  parentPath: string
  createdAt: string
  updatedAt: string
}
```

不变量：

1. 每个存储组必须且只能属于一个卷。
2. 一个活动卷至少包含一个存储组。创建新卷时必须同时选择要迁入的组；迁出最后一个组时，操作确认页明确告知该卷将被归档并解除 Git 定时同步。
3. 一个父目录只能承载一个活动 ASH 卷。
4. 卷不能嵌套在另一个卷的 `.manta-ai` 内。
5. 一个卷最多绑定一个 Git 仓库。
6. 卷 ID 在迁移路径和更名时保持不变。
7. Git 绑定跟随卷迁移，不跟随单个组；组迁入后自动加入该卷下一次快照，迁出后自动移除。

### 6.3 简单模式与高级模式

首次安装只创建一个默认卷并包含全部七个组。用户可以永远停留在该模式：

```text
默认卷 -> ~/chosen-parent/.manta-ai -> 可选一个 Git 仓库
```

高级用户可在设置中创建多个卷：

```text
Agent 能力卷 -> iCloud/AgentAssets/.manta-ai
  extensions, config
  Git: private repository A

知识工作卷 -> iCloud/Knowledge/.manta-ai
  knowledge, work
  Git: private repository B

本机运行卷 -> ~/MantaLocal/.manta-ai
  secrets, diagnostics, cache
  Git: disabled
```

## 7. 物理目录与控制面

### 7.1 卷目录

用户选择的是父目录，ASH 固定创建 `.manta-ai`：

```text
<parent>/.manta-ai/
├── ash-volume.json
├── extensions/
├── knowledge/
├── work/
├── config/
├── secrets/
├── diagnostics/
├── cache/
└── .ash-backups/
```

只创建属于该卷的组目录。`ash-volume.json` 是卷身份和恢复信息，不包含凭据：

```ts
export interface AshVolumeManifest {
  schemaVersion: 1
  volumeId: string
  name: string
  state: 'active' | 'backup' | 'archived'
  groups: StorageGroupId[]
  generation: number
  createdAt: string
  updatedAt: string
}
```

### 7.2 Bootstrap

Electron 必须在后端启动前知道卷位置，因此允许一个极小的非业务定位文件：

```text
Electron app.getPath('userData')/ash-bootstrap.json
```

这是“所有业务持久化数据进入 `.manta-ai`”规则的唯一控制面例外。它不保存会话、配置、密钥或资产，只保存查找卷和恢复迁移所需的数据。

```ts
export interface AshBootstrap {
  schemaVersion: 1
  generation: number
  volumes: StorageVolumeRecord[]
  groupAssignments: Record<StorageGroupId, string>
  previous?: AshLocationSnapshot
  pendingMigration?: MigrationJournal
}
```

`groupAssignments` 是组归属的权威记录；`ash-volume.json` 中的 `groups` 是位于该物理卷上的恢复清单。正常启动要求两者一致。Git 绑定不进入 Bootstrap，而是按 volumeId 保存在 `config` 组中，因此 Bootstrap 仍只承担定位和迁移恢复职责。

Bootstrap 是跨卷事务的最终提交点。卷 Manifest 用于身份验证和灾难恢复，但当两者冲突时，启动恢复器根据 Bootstrap generation、事务 Journal 和卷 ID 作出确定性判断，不凭文件时间戳猜测。

所有 Bootstrap 和 Manifest 更新均使用：同目录临时文件、刷新文件内容、原子 rename；支持的平台上同时刷新父目录。不得直接截断并覆写活动配置文件。

### 7.3 Headless 与开发模式

- Electron 桌面版使用 Bootstrap。
- 后端单独开发运行时，通过测试专用的启动参数注入一个临时单卷配置。
- Docker/headless 运行通过 `MANTA_ASH_ROOT` 指定父目录；未指定时使用 `$HOME/.manta-ai` 的单默认卷。
- 原 `MANTA_DATA_DIR` 在迁移期仅作为一次性开发兼容输入，所有业务代码不得读取它。

## 8. 唯一路径路由

业务模块只能从注入的 `StorageHub` 获取路径：

```ts
export interface StorageHub {
  resolve(group: StorageGroupId, ...segments: string[]): string
  volumeFor(group: StorageGroupId): StorageVolumeRecord
  inventory(scope?: { volumeId?: string; groupId?: StorageGroupId }): Promise<StorageInventory>
  acquireRead(group: StorageGroupId): Promise<StorageLease>
  acquireWrite(group: StorageGroupId): Promise<StorageLease>
}
```

示例：

```ts
storage.resolve('extensions', 'skills')
storage.resolve('knowledge', 'rag', knowledgeBaseId)
storage.resolve('work', 'conversations', conversationId)
storage.resolve('diagnostics', 'logs', 'system.ndjson')
```

路由器必须：

- 拒绝绝对 segment、`..` 和空字节。
- 对 Windows/macOS 大小写语义进行规范化比较。
- 防止最终路径逃离组根目录。
- 保留但不跟随迁移过程中遇到的符号链接，避免递归和复制外部用户数据。
- 拒绝把迁移目标放在源目录内部，或把源目录放在目标内部。

静态检查禁止应用持久化代码出现以下模式：

- `path.join(os.homedir(), '.manta-data', ...)`
- 运行时写入 `<workspace>/.manta/...`
- 未通过 StorageHub 注入的内部 `writeFile`、`appendFile`、SQLite 路径或日志目录。

用户/Agent 明确指定的项目工作区和输出路径不受该规则约束。检查器按模块边界和标注判断，不全局禁止正常文件工具。

## 9. 现有 I/O 归一化范围

当前扫描已发现以下需要迁移的类别；实施阶段必须重新执行全仓库扫描并维护机器可检查的允许清单。

### 9.1 `.manta-data` 硬编码

- Backend server 默认数据目录。
- Conversation、Workspace、Workflow、App、Memory、Knowledge Base Store。
- LLM、Embedding、Workspace、MCP 配置。
- RAG SQLite、Vector Provider 和 Embedding Cache。
- Context Snapshot、TODO、Runner Registry。
- System/Conversation Logs、Audit、文件访问权限记录。
- Desktop 打开数据目录和重置系统。

### 9.2 仓库 `.manta` 与其他运行时目录

- `.manta/skills`。
- `.manta/plugins`。
- `.manta/plugin-marketplace`。
- `~/.manta/agents` 形式的 Agent 运行时数据。

随安装包发布的内置 Skills/Plugins 是只读种子资源，可以位于应用资源目录。首次初始化或版本升级时，ASH 将其注册或复制到 `extensions` 组；运行时安装、启用、下载、更新和用户修改只能写入卷。

### 9.3 Frontend 浏览器持久化

- 主题、颜色模式、Webhook 和其他应用偏好迁入 `config` 组。
- API Key、OAuth 等进入 `secrets` 组。
- IndexedDB 中的上传暂存和批处理恢复数据迁入 `cache` 组。
- Frontend 可以保留纯会话级内存状态；不得把长期事实只保存在 localStorage/IndexedDB。

## 10. 首次安装初始化

### 10.1 启动顺序

```text
app.whenReady
  -> 读取并校验 ash-bootstrap.json
  -> 未初始化：显示 OnboardingWindow，不启动 Backend
  -> 已初始化：校验所有卷可达且 Manifest 匹配
  -> 构造 StorageHub
  -> 启动 Backend
  -> Backend 健康检查成功
  -> 显示主窗口
```

### 10.2 必选向导

首次向导只要求完成一个必选项：默认卷父目录。提供：

- 用户文件夹（默认）：实际路径 `~/.manta-ai`。
- 检测到的 iCloud Drive。
- 选择其他文件夹。

确认前执行：

- 绝对路径和父子嵌套检查。
- 写权限探针：创建、刷新、rename、读取并删除临时文件。
- 可用空间检查。
- 检查目标是否已有 ASH 卷或普通 `.manta-ai` 目录。
- 创建全部七个组、卷 Manifest 和 Bootstrap。

用户不能跳过，可以退出应用。Git 设置放在初始化完成后的存储页面，不增加首次启动阻力。

若开发构建检测到 `~/.manta-data` 且 ASH 尚未初始化，向导显示可选的“导入现有开发数据”。选择导入后复用正式迁移引擎；生产构建不建立旧版本兼容矩阵。

## 11. 设置页“存储”Tab

### 11.1 概览

显示：

- 所有卷主数据的逻辑大小和实际物理占用。
- 各组大小、文件数和最后扫描时间。
- 内容去重实际节省量。
- Git 本地缓存和同步副本占用，单独统计。
- 可安全清理的 cache、旧迁移临时目录和用户确认可删的备份。
- 异常状态：卷离线、Manifest 不一致、Git 冲突、迁移待恢复。

### 11.2 卷卡片

每个卷显示：

- 名称、完整路径和检测到的文件夹提供方。
- 包含的存储组。
- 总容量、各组容量、文件数和可清理量。
- Git 仓库、分支、上次同步、待推送/待拉取和冲突状态。
- 操作：打开目录、迁移位置、编辑名称、配置 Git、立即同步、查看历史。

### 11.3 存储组操作

- 查看内容分类与大小。
- 移动到现有卷。
- 创建新卷并移动。
- 查看最近迁移和验证结果。
- cache 组支持一键安全清理。

### 11.4 危险操作

- 迁移、恢复、删除备份和同步 secrets 前展示具体影响范围，不使用模糊的“确认”文案。
- 正在迁移时禁止开始第二个迁移或 Git 导入事务。
- 重置系统按卷和组执行，不能再写死删除 `~/.manta-data`。

## 12. 生命周期与维护模式

当前 Backend 在模块顶层自行启动，无法安全迁移。需要改为显式生命周期：

```ts
export interface MantaServerHandle {
  port: number
  quiesce(groups?: StorageGroupId[]): Promise<void>
  close(): Promise<void>
  healthCheck(): Promise<HealthResult>
}

export async function startServer(options: {
  storage: StorageHub
}): Promise<MantaServerHandle>
```

存储组驱动暴露自己的生命周期：

```ts
export interface StorageGroupDriver {
  id: StorageGroupId
  quiesce(): Promise<void>
  checkpoint(): Promise<void>
  close(): Promise<void>
  validate(root: string): Promise<ValidationResult>
  reopen(root: string): Promise<void>
  inventory(root: string): Promise<StorageInventory>
}
```

迁移开始后：

- 新写请求返回 `STORAGE_MIGRATION_IN_PROGRESS`。
- 已获得的写 Lease 在截止时间内完成；超时则迁移取消，不强杀写入。
- 复制阶段允许安全读取；进入最终 checkpoint 和提交阶段后冻结相关组读取。
- 卷迁移锁定卷内全部组；组迁移只锁定源组和目标卷 Manifest。
- 首版所有成功迁移都立即重启应用，以清除未知的历史文件句柄。

## 13. 迁移事务

### 13.1 状态机

```ts
export type MigrationPhase =
  | 'planned'
  | 'quiescing'
  | 'copying'
  | 'validating'
  | 'committing'
  | 'restarting'
  | 'verifying'
  | 'completed'
  | 'rolling-back'
  | 'failed'
```

Journal 至少记录：事务 ID、类型、源、目标、涉及组、源/目标 generation、阶段、进度、文件清单摘要、错误和回滚路径。

同一时间只允许一个会改变卷映射的事务。

### 13.2 迁移整个卷

1. 规范化并校验目标父目录。
2. 检查目标为空或不存在；不自动合并已有 `.manta-ai`。
3. 统计源文件大小；要求可用空间不低于源大小加 10%，且额外余量不少于 256 MiB。
4. 写入 `planned` Journal。
5. 获取卷排他 Lease，停止新写入并等待活动写入结束。
6. 对数据库执行 checkpoint，关闭数据库、日志 Writer、Watcher 和插件安装器。
7. 在目标创建 `.manta-ai.migrating-<transactionId>`。
8. 复制卷；保留权限和安全符号链接，不跟随链接内容。
9. 校验相对路径、文件类型、字节数和 SHA-256。
10. 调用各组 Driver 做 JSON Schema、SQLite integrity、Vector 元数据和 Extension Manifest 校验。
11. 将临时目录原子 rename 为 `.manta-ai`。
12. 写入目标卷新 generation Manifest。
13. 原子更新 Bootstrap；这是提交点。
14. 保存 previous snapshot，调用 `app.relaunch()` 并退出。
15. 新进程打开所有组并执行健康验证。
16. 成功后标记事务完成；原卷成为只读备份卷。

卷 ID、名称、组归属和 Git 绑定不变，只改变 `parentPath`。

### 13.3 将组移动到其他卷

1. 验证目标卷不含该组，且不存在同名活动组目录。
2. 统计组大小并检查目标空间。
3. 锁定该组和两个卷 Manifest。
4. checkpoint/关闭该组资源。
5. 复制到目标卷 `.ash-staging/<transactionId>/<groupId>`。
6. 执行通用哈希校验和该组 Driver 校验。
7. 原子 rename 到目标组目录。
8. 先写目标卷 Manifest，再写源卷 Manifest。
9. 原子更新 Bootstrap 中 `groupAssignments`；这是提交点。
10. 将源组移动到源卷 `.ash-backups/<transactionId>/<groupId>`。
11. 立即重启并验证新路径。

跨文件系统不存在一次 rename 同时更新两个卷，因此 Bootstrap generation 是唯一可判定的提交记录。提交前崩溃继续使用源组；提交后失败恢复 previous snapshot。

### 13.4 失败和断电恢复

- `committing` 前失败：源映射不变，删除或隔离目标暂存目录。
- Bootstrap 提交后但重启验证失败：恢复 previous Bootstrap，重新打开源位置并报告错误。
- 源位置也不可用：进入恢复窗口，不创建静默本地空卷。
- iCloud 或外置盘离线：提供重试、重新定位同一 volumeId 或显式恢复备份；不自动产生分叉副本。
- 崩溃后通过 pending Journal 恢复；不得仅根据目录是否存在猜测成功。

### 13.5 自动备份

- 迁移完成后不立即删除源数据。
- 组迁移备份放入源卷 `.ash-backups/<transactionId>/<groupId>`。
- 整卷迁移保留原卷；新位置启动验证成功后，将源 `ash-volume.json` 的 state 原子更新为 `backup`，并记录对应事务 ID。若该标记写入失败，Bootstrap 仍是活动位置的权威来源，重复 volumeId 会在下次选择目录时被识别为备份候选而不是新卷。
- 第一版备份永久保留，由用户在设置页查看大小并手动删除。
- 删除前再次校验当前活动卷和备份 volumeId，防止误删活动数据。

## 14. Git 与文件夹同步

### 14.1 用户模型

- iCloud/OneDrive/Dropbox：通过选择相应文件夹作为卷位置获得系统同步；ASH 不提供伪造的“立即同步云盘”操作。
- Git：在卷级配置；一个卷至多一个 Git 绑定。
- 默认单卷用户只需管理一个仓库。
- 高级用户按隐私或用途拆卷后，可为每个卷选择不同的私有仓库或不启用 Git。

```ts
export interface GitBinding {
  id: string
  volumeId: string
  remoteUrl?: string
  branch: string
  authRef?: string
  schedule: 'manual' | 'startup' | 'interval'
  intervalMinutes?: number
  lastSyncedCommit?: string
  lastSyncedGroupHashes?: Partial<Record<StorageGroupId, string>>
}
```

`remoteUrl` 为空时支持只在本机形成 Git 历史；设置远端后支持 fetch/push。

### 14.2 Git 不直接覆盖活动卷

“卷绑定 Git”是用户模型，不代表对活动卷直接执行危险 checkout。ASH 在本机 `cache` 组维护可重建的 Git 工作区：

```text
活动卷 -> 一致性快照 -> Git 缓存工作区 -> commit/push
remote -> fetch -> 导入暂存区 -> 校验 -> 事务应用到活动卷
```

Git 缓存不进入任何卷的同步快照，也不计入主存储去重收益。

### 14.3 快照规则

- 普通文件按卷目录结构进入仓库。
- SQLite 在获取组锁后执行 WAL checkpoint；仓库保存一致的数据库快照，不提交活动 WAL/SHM。
- Vector DB 调用 Provider 的 snapshot/validate 能力；不支持快照的 Provider 必须关闭后复制。
- 锁文件、未完成迁移目录、临时文件和 Git 认证信息永远排除。
- cache 中被定义为有效、可恢复的用户暂存数据可以同步；纯派生 Git 工作区和事务临时数据不属于有效持久化数据。
- secrets 可以进入 Git，但必须展示不可绕过的高风险确认；私有仓库不被描述为绝对安全。

### 14.4 同步事务和冲突

每次快照生成 `ash-sync-manifest.json`，包含 schema、volumeId、generation、组内容哈希和源设备 ID。

比较本地、远端与 `lastSyncedGroupHashes`：

- 仅本地变化：提交并推送。
- 仅远端变化：校验后事务式导入并重启受影响模块；首版统一重启应用。
- 两端不同组发生变化：自动组合。
- 同一组两端均变化：进入组级冲突，不覆盖任一方。
- 对不可变资产的纯新增可以按内容哈希自动合并。
- 对同一资产修改、二进制数据库或删除/修改冲突，由用户选择保留本机、保留远端或复制为新资产。

Git 命令失败、认证失败或网络离线不影响活动卷正常使用，只更新同步状态和重试计划。

### 14.5 双重同步

卷可以位于 iCloud，同时绑定 Git。ASH 允许这种配置，但明确提示：

- iCloud 可能在 ASH 不知情的情况下改变本地文件。
- Git 导入前必须确认卷稳定，重新扫描 generation 和冲突副本。
- 检测到 iCloud 冲突副本时暂停 Git push，先让用户处理。

## 15. 内容寻址与真实去重

“节省存储空间”必须有可验证的技术基础。阶段 3 为适合去重的不可变资产建立 SHA-256 内容库：

```text
<volume>/.manta-ai/.ash/objects/sha256/ab/cdef...
<group>/manifests/<asset-id>.json -> object hashes
```

首批纳入：

- 用户导入的原始知识文档。
- Skill 源包和已发布版本。
- Plugin 安装包和不可变资源。
- Marketplace 下载包。

不纳入：

- 活动 SQLite/Vector 数据库。
- 日志、审计和进程状态。
- 凭据。
- 高频变化的配置和会话文件。

同一卷内通过硬链接或 reflink 物化不可变对象；不支持时复制。跨卷内容不能宣称物理去重，因为独立卷和离线能力要求各自保存副本。

统计定义：

```text
逻辑大小 = 所有资产引用展开后的总大小
实际占用 = 活动卷真实分配空间
去重节省 = 无去重逻辑大小 - 内容对象及必要物化的实际占用
同步副本 = Git 缓存及其他显式副本占用，单独展示
```

引用计数归零后对象先进入垃圾候选区；至少经过一次完整一致性扫描且没有活动迁移或同步事务时才可删除。

## 16. 外部 Agent 适配边界

ASH 管理资产和投影，不接管外部 Agent 的 Harness。

```ts
export interface AgentAdapter {
  id: string
  displayName: string
  detect(): Promise<AgentInstallation[]>
  inspect(target: AgentInstallation): Promise<AgentAssetInventory>
  planImport(target: AgentInstallation): Promise<ImportPlan>
  planProjection(selection: AssetSelection, target: AgentInstallation): Promise<ProjectionPlan>
  apply(plan: ApprovedAdapterPlan): Promise<AdapterResult>
}
```

所有导入和投影先生成预览计划，显示将读取、创建、修改或删除的原生文件。用户确认后执行，并保留 adapter journal 和备份。

第一适配器选择 Codex，用于验证：

- Skills 发现和投影。
- AGENTS/Instructions 的映射。
- MCP 配置的非敏感部分与凭据引用分离。
- 同一 ASH 资产被多个 Agent 使用时不复制不可变对象；同文件系统优先硬链接/reflink，跨文件系统复制并计为投影副本。

## 17. 安全设计

- 目录选择、迁移、删除和 Git 导入由 Electron 主进程执行，Renderer 不能传任意未校验命令。
- IPC 使用显式 Schema 校验，不暴露通用文件系统写接口。
- Git 认证通过 `authRef` 引用 secrets，不写入仓库配置或日志。
- 日志对路径、远端 URL 中的凭据和 Token 进行脱敏。
- 迁移不跟随符号链接，防止把用户外部目录意外复制进卷。
- 卷 Manifest 和同步 Manifest 不保存密钥。
- secrets 卷进入 Git 前必须二次确认并明确说明 Git 历史不可轻易清除。
- 未来便携凭据同步采用独立加密 Vault；在该能力完成前，不把“私有 Git”宣传为凭据安全方案。
- 删除备份、卷或组必须验证活动映射，拒绝删除 Bootstrap 当前引用路径。

## 18. API 与 IPC

只读和状态查询可通过本地 Backend API：

```text
GET  /api/storage/overview
GET  /api/storage/volumes
GET  /api/storage/volumes/:id
GET  /api/storage/operations/:id
GET  /api/storage/backups
```

需要目录选择、停服和重启的特权操作通过 Electron IPC：

```text
storage:select-parent
storage:create-volume
storage:relocate-volume
storage:move-group
storage:configure-git
storage:sync-volume
storage:delete-backup
storage:open-volume
```

IPC 返回操作 ID；Renderer 订阅结构化进度事件：

```ts
export interface StorageOperationProgress {
  operationId: string
  phase: string
  currentGroup?: StorageGroupId
  filesCompleted: number
  filesTotal: number
  bytesCompleted: number
  bytesTotal: number
  message: string
}
```

Frontend 不根据 message 推断状态，只使用 phase 和结构化字段。

## 19. 测试策略

### 19.1 单元测试

- Bootstrap/Manifest 原子写与 generation 选择。
- 存储组唯一归属、卷不嵌套和路径逃逸拒绝。
- 路由解析在 Windows、macOS 和 Linux 路径语义下正确。
- 文件清单、哈希、符号链接和容量计算。
- 同步三方状态比较和冲突分类。
- 去重引用计数和垃圾候选规则。

### 19.2 集成测试

- 默认单卷首次初始化。
- 自定义父目录创建 `.manta-ai`。
- 整卷同文件系统和跨文件系统迁移。
- 单组迁入已有卷和创建新卷后迁移。
- 目标无权限、空间不足、目标冲突和目标嵌套。
- 复制中断、校验失败、提交前崩溃、提交后启动失败和自动回滚。
- SQLite WAL checkpoint、数据库 integrity 和 Vector Snapshot。
- Git 本地提交、远端 push/pull、认证失败、离线和同组冲突。
- iCloud 路径离线和冲突副本模拟。

### 19.3 端到端测试

- 首次启动无法跳过初始化。
- 初始化后 Backend 健康接口报告所有组实际路径。
- 设置页创建卷、移动组、迁移卷并立即重启。
- 重启后会话、知识库、Plugin、Skill、配置和日志继续在新路径读写。
- 原位置存在可识别备份，用户确认后可以安全删除。
- Git 绑定和同步状态在 UI 中准确呈现。
- 用户工作区文件和明确输出路径不被 ASH 重定向。

### 19.4 静态审计

CI 执行仓库扫描并维护精确允许清单：

- 禁止生产持久化代码出现 `.manta-data`。
- 禁止运行时安装内容写入仓库 `.manta`。
- 禁止内部 Store 直接使用 `homedir()` 构造数据根。
- 审计 `writeFile`、`appendFile`、`mkdir`、SQLite、日志 Writer 和下载目的路径。
- 允许用户文件工具、构建脚本、发布脚本和测试临时目录，但必须位于明确允许模块。

## 20. 验收标准

以下条件全部满足，阶段 1 才可宣称原始“自定义数据位置与迁移”需求完成：

1. 新安装首次启动必须选择默认卷位置，实际目录名为 `.manta-ai`。
2. 所有七个存储组都通过 ASH 路由，已知 `.manta-data` 和运行时仓库 `.manta` 写入清零。
3. 应用内部长期 localStorage/IndexedDB 持久化清零或迁入对应组。
4. 设置页可以查看卷、组、真实路径、大小、文件数和状态。
5. 用户可以安全迁移整个卷，并在成功后自动重启。
6. 用户可以创建其他卷并把任一存储组迁移过去。
7. 迁移对文件和组语义做校验，失败不切换路径。
8. 提交后新位置无法启动时可以自动恢复上一配置。
9. 源数据作为备份保留，不能误删活动卷。
10. 迁移后所有后续内部读写都发生在新位置。
11. 用户或 Agent 明确指定的项目文件和输出目录保持不变。
12. Windows 和 macOS 的路径、权限和重启流程有自动化覆盖。

阶段 2 完成标准：每个卷可绑定一个 Git 仓库，能够快照、同步、检测冲突并安全导入；iCloud 目录由系统同步且 ASH 能处理离线与冲突状态。

阶段 3 完成标准：文档、Skill 和 Plugin 的重复内容实际只占一份空间，并能用可复算指标证明节省量。

阶段 4 完成标准：Codex 适配器能预览并应用至少 Skills、Instructions 和 MCP 非敏感配置的双向资产操作，同时不实现或替换 Codex Harness。

## 21. 最终产品表达

```text
Manta ASH
统一 Agent 存储架构

一份能力，所有 Agent。
One Library. Every Agent.

Skills、Plugins、知识与配置只需保存一次，
即可统一管理、自由迁移，并适配多个 Agent。
```

存储页面可以真实展示：

```text
逻辑资产大小       18.4 GB
实际主存储占用      9.7 GB
ASH 已节省          8.7 GB
被多个 Agent 复用    126 项能力
```

只有阶段 3 的内容寻址和物理占用测量上线后，产品才能对外展示“ASH 已节省”指标。
