---
name: tool-registry-setup
overview: 在 core/tool-registry/ 搭建 ToolRegistry，统一使用 ToolDefinition 接口定义工具，并立即迁移 conversationTools、fsTools、ccTools 三个工具集，最后修改 agent-loop.ts 接入 ToolRegistry。
todos:
  - id: create-tool-registry
    content: 创建 core/tool-registry/ 模块（types.ts、utils.ts、registry.ts、index.ts）
    status: completed
  - id: migrate-tools
    content: 迁移 conversationTools 和 fsTools 到 ToolDefinition 格式
    status: completed
    dependencies:
      - create-tool-registry
  - id: migrate-cc-tools
    content: 迁移 ccTools 到 ToolDefinition 格式（最大最复杂）
    status: completed
    dependencies:
      - create-tool-registry
  - id: update-agent-loop
    content: 修改 agent-loop.ts 使用 ToolRegistry 获取工具
    status: completed
    dependencies:
      - migrate-tools
      - migrate-cc-tools
  - id: cleanup-verify
    content: 清理旧代码，验证编译通过和类型正确
    status: completed
    dependencies:
      - update-agent-loop
---

## 用户需求

搭建 ToolRegistry 模块，统一管理的工具注册、查找和 AI SDK 格式转换。

## 产品概述

ToolRegistry 作为工具的统一管理中心，做三件事：

1. 注册工具（支持批量注册）
2. 查找工具（按名称查找或获取全部）
3. 转换成 AI SDK 需要的格式（`toAISDKFormat()`），同时在 `execute` 里包一层截断逻辑

## 核心功能

- **ToolDefinition 接口**：统一工具定义格式，包含 name、description、parameters（JSON Schema 对象）、isConcurrencySafe、isReadOnly、maxResultChars、execute
- **ToolRegistry 类**：提供 register、get、getAll、toAISDKFormat 方法
- **truncateResult 函数**：对工具执行结果进行截断，防止超大输出
- **迁移现有工具**：将 conversationTools（6个）、fsTools（4个）、ccTools（12个）全部迁移到 ToolDefinition 格式
- **集成到 Agent Loop**：agent-loop.ts 改为从 ToolRegistry 获取工具，不再直接引用三个 tools 对象

## 技术栈

- **语言**：TypeScript
- **依赖**：`ai`（Vercel AI SDK）的 `jsonSchema` 工具
- **模块系统**：ES Module（与项目现有结构一致）

## 实现方案

### 总体策略

在 `core/tool-registry/` 目录搭建独立的 ToolRegistry 模块，将工具定义从 `tool()` + `jsonSchema()` 直接创建改为统一的 `ToolDefinition` 接口，由 `ToolRegistry.toAISDKFormat()` 负责转换为 AI SDK 格式并包装 `execute` 加入截断保护。

### 关键设计决策

1. **ToolDefinition.parameters 使用原始 JSON Schema 对象**：不再预先用 `jsonSchema()` 包装，`toAISDKFormat()` 转换时才调用 `jsonSchema()`
2. **execute 签名统一**：`(input: Record<string, unknown>) => Promise<unknown>`，与 AI SDK 调用时传入的 input 对象类型一致
3. **截断逻辑内置于 toAISDKFormat()**：Agent Loop 不需要关心截断细节
4. **向后兼容**：保留原有工具文件的路径，只修改导出内容，不影响其他可能引用这些工具的地方（如有）

### 实现细节

#### 1. 新建 `core/tool-registry/` 模块

**types.ts** - ToolDefinition 接口定义

```typescript
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  isConcurrencySafe?: boolean
  isReadOnly?: boolean
  maxResultChars?: number
  execute: (input: Record<string, unknown>) => Promise<unknown>
}
```

**utils.ts** - truncateResult 工具函数

- `DEFAULT_MAX_RESULT_CHARS = 3000`
- 60% 头部 + 40% 尾部策略
- 返回带省略提示的字符串

**registry.ts** - ToolRegistry 类

- 内部使用 `Map<string, ToolDefinition>` 存储
- `toAISDKFormat()` 遍历所有工具，调用 `jsonSchema(tool.parameters)` 创建 inputSchema，并包装 execute 加入截断

**index.ts** - 统一导出

#### 2. 迁移现有工具

三个文件统一改为导出 `ToolDefinition[]`：

- `core/conversation/tools.ts` → 导出 `conversationToolDefs`
- `core/conversation/fs-tools.ts` → 导出 `fsToolDefs`
- `core/conversation/cc-tools.ts` → 导出 `ccToolDefs`

每个工具的修改：

- 移除 `tool()` 和 `jsonSchema()` 的直接调用
- `parameters` 字段写为原始 JSON Schema 对象
- `execute` 接收 `Record<string, unknown>` 类型参数
- 工具名称通过 `name` 字段指定（不再是对象的 key）

#### 3. 修改 agent-loop.ts

- 移除 `ALL_TOOLS` 常量
- 移除对 `conversationTools`、`fsTools`、`ccTools` 的 import
- 新增对 `ToolRegistry` 和三个 `ToolDefinition[]` 的 import
- 在 `runAgentLoop` 内创建 ToolRegistry 实例，注册所有工具，调用 `toAISDKFormat()` 获取 AI SDK 格式工具

### 性能考虑

- ToolRegistry 使用 Map 存储，查找复杂度 O(1)
- `toAISDKFormat()` 在每次调用时遍历所有工具进行转换，但工具数量有限（共22个），性能影响可忽略
- 截断操作只在 execute 返回结果后进行，且只处理需要截断的大结果

### 向后兼容性

- 工具定义改为 ToolDefinition 后，AI SDK 格式由 ToolRegistry 统一生成，确保格式一致
- agent-loop.ts 的修改集中在工具获取方式，不影响循环逻辑本身

## 架构设计

### 系统架构

```mermaid
graph TD
    A[agent-loop.ts] -->|创建并注册| B[ToolRegistry]
    B -->|toAISDKFormat| C[AI SDK 格式工具]
    C -->|传入| D[streamText]
    
    E[tools.ts] -->|导出 ToolDefinition[]| B
    F[fs-tools.ts] -->|导出 ToolDefinition[]| B
    G[cc-tools.ts] -->|导出 ToolDefinition[]| B
    
    B -->|内部| H[Map&lt;string, ToolDefinition&gt;]
```

### 数据流

1. 各工具文件定义 `ToolDefinition[]` 并导出
2. `agent-loop.ts` 创建 `ToolRegistry` 实例
3. 调用 `register()` 注册所有工具的 `ToolDefinition`
4. 调用 `toAISDKFormat()` 转换为 AI SDK 格式（含截断包装）
5. 将转换后的工具传入 `streamText()`

## 目录结构

```
core/
├── tool-registry/           # [NEW] ToolRegistry 模块
│   ├── index.ts            # 统一导出
│   ├── types.ts            # ToolDefinition 接口定义
│   ├── utils.ts            # truncateResult 函数
│   └── registry.ts        # ToolRegistry 类实现
├── conversation/
│   ├── tools.ts           # [MODIFY] 改为导出 ToolDefinition[]
│   ├── fs-tools.ts        # [MODIFY] 改为导出 ToolDefinition[]
│   └── cc-tools.ts        # [MODIFY] 改为导出 ToolDefinition[]
└── chat/
    └── agent-loop.ts       # [MODIFY] 改为使用 ToolRegistry
```

### 文件详细说明

**core/tool-registry/types.ts** [NEW]

- 定义 `ToolDefinition` 接口
- 包含 name、description、parameters、isConcurrencySafe、isReadOnly、maxResultChars、execute 字段

**core/tool-registry/utils.ts** [NEW]

- 实现 `truncateResult` 函数
- 实现 `DEFAULT_MAX_RESULT_CHARS` 常量

**core/tool-registry/registry.ts** [NEW]

- 实现 `ToolRegistry` 类
- 方法：register、get、getAll、toAISDKFormat

**core/tool-registry/index.ts** [NEW]

- 统一导出 ToolDefinition、ToolRegistry、truncateResult

**core/conversation/tools.ts** [MODIFY]

- 将6个工具的 `tool()` 定义改为 `ToolDefinition` 对象
- 移除 `conversationTools` 对象导出
- 导出 `conversationToolDefs: ToolDefinition[]`

**core/conversation/fs-tools.ts** [MODIFY]

- 将4个工具的 `tool()` 定义改为 `ToolDefinition` 对象
- 移除 `fsTools` 对象导出
- 导出 `fsToolDefs: ToolDefinition[]`
- 保留 `checkAccess`、`walkFiles`、`globToRegExp` 等辅助函数（不导出）

**core/conversation/cc-tools.ts** [MODIFY]

- 将12个工具的 `tool()` 定义改为 `ToolDefinition` 对象
- 移除 `ccTools` 对象导出
- 导出 `ccToolDefs: ToolDefinition[]`
- 保留 `readTodos`、`writeTodos`、`bashTaskRegistry` 等辅助变量和函数

**core/chat/agent-loop.ts** [MODIFY]

- 移除 `ALL_TOOLS` 常量（第18行）
- 移除 `conversationTools`、`fsTools`、`ccTools` 的 import
- 新增 `ToolRegistry` 和三个 `ToolDefinition[]` 的 import
- 在 `runAgentLoop` 中创建 ToolRegistry 实例并注册工具
- 将 `streamText({ tools: ALL_TOOLS })` 改为使用 `toolRegistry.toAISDKFormat()` 的结果