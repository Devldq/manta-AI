---
name: workspace-implementation-fixes
overview: 修复工作空间实现中的三个核心问题：1) 选择新文件夹时重复创建工作空间 2) 工作空间选择器弹出框无滚动 3) 创建的工作空间和对话不回显到左侧工作空间组
todos:
  - id: add-folderpath-type
    content: "在 @manta/shared/src/types.ts 中的 WorkspaceConfig 和 CreateWorkspaceInput 接口添加 folderPath?: string 字段"
    status: completed
  - id: fix-backend-create-ws
    content: 修复后端 createWorkspace 存储函数，保存 folderPath 并添加按 folderPath 去重逻辑
    status: completed
    dependencies:
      - add-folderpath-type
  - id: fix-frontend-store
    content: 修复前端 workspace-store 的 createWorkspace 方法，在请求体中传递 folderPath
    status: completed
    dependencies:
      - add-folderpath-type
  - id: fix-handlesend
    content: 修复 NewChatDraft.handleSend，使用 store 的 createWorkspace 方法并清除 pending 状态
    status: completed
    dependencies:
      - fix-frontend-store
  - id: fix-workspace-selector
    content: 修复 WorkspaceSelector 下拉菜单，添加滚动支持并移除 .slice(0, 10) 限制
    status: completed
---

## 用户需求

修复工作空间功能中的三个问题：

### 问题1：选择新文件夹作为工作空间会创建好几个（重复创建）

**现象**：用户通过"选择新的工作空间"按钮选择文件夹后，发送消息时可能创建多个同名/同路径的工作空间。
**根本原因**：

1. `WorkspaceConfig` 和 `CreateWorkspaceInput` 类型定义中缺少 `folderPath` 字段，后端创建工作空间时不保存文件夹路径
2. 后端没有按 `folderPath` 去重逻辑，重复选择同一文件夹会创建多个工作空间
3. `NewChatDraft.handleSend()` 中创建工作空间后未清除 `pendingFolderName` 和 `pendingFolderPath` 状态
4. 前端直接调用 API 而非使用 store 的 `createWorkspace` 方法（后者会正确清除缓存并刷新列表）

### 问题2：工作空间选择器弹出菜单没有滚动

**现象**：当工作空间数量超过一屏时，下拉菜单无法滚动，超出部分不可见。
**根本原因**：`WorkspaceSelector` 组件的下拉菜单（Portal 渲染）内部容器没有设置 `max-height` 和 `overflow-y: auto`，且列表被 `.slice(0, 10)` 限制只显示前10条。

### 问题3：创建的工作空间和对话没有回显到左侧工作空间组

**现象**：选择新文件夹、发送消息创建工作空间和对话后，左侧侧边栏的工作空间组没有显示新创建的工作空间和对话，导致无法继续对话。
**根本原因**：

1. `NewChatDraft.handleSend()` 直接调用 API 创建和空间，而不是使用 store 的 `createWorkspace` 方法
2. Store 的 `createWorkspace` 方法会调用 `invalidateCache('workspaces:')` 和 `fetchList()` 来刷新列表，但直接调用 API 绕过了缓存失效逻辑
3. `swrFetch` 缓存有效期为30秒，期间再次调用 `fetchList()` 会返回旧数据

## 技术方案

### 问题1：修复重复创建工作空间

#### 1.1 类型定义层（`packages/shared/src/types.ts`）

- 在 `WorkspaceConfig` 接口中添加 `folderPath?: string` 字段
- 在 `CreateWorkspaceInput` 接口中添加 `folderPath?: string` 字段

#### 1.2 后端存储层（`packages/backend/src/core/storage/workspace/store.ts`）

- 修改 `createWorkspace` 函数，将 `input.folderPath` 保存到配置中
- 在 `createWorkspace` 添加去重逻辑：遍历已有工作空间，若 `folderPath` 相同则直接返回已有工作空间，不再创建新实例

#### 1.3 前端页面层（`packages/frontend/src/pages/tasks/page.tsx`）

- 修改 `NewChatDraft.handleSend()`：
- 使用 `useWorkspaceStore.getState().createWorkspace(...)` 代替直接 `fetch` 调用 API
- 创建工作空间成功后，清除 `pendingFolderName` 和 `pendingFolderPath` 状态

#### 1.4 前端 Store 层（`packages/frontend/src/stores/workspace-store.ts`）

- 修改 `createWorkspace` 方法，在请求体中传递 `folderPath` 字段（从 `CreateWorkspaceInput` 中读取）

---

### 问题2：工作空间选择器添加滚动

#### 2.1 修改 `WorkspaceSelector` 组件（`packages/frontend/src/pages/tasks/components/WorkspaceSelector.tsx`）

- 移除 `.slice(0, 10)` 限制，展示所有工作空间
- 在下拉菜单的内部 `<div>`（line 176，`style={{ padding: '6px' }}`）添加：
- `maxHeight: '240px'`
- `overflowY: 'auto'`
- `scrollbarWidth: 'thin'`（可选，优化滚动条样式）

---

### 问题3：工作空间和对话回显到侧边栏

#### 3.1 确保工作空间创建后侧边栏刷新（依赖问题1的修复）

- 使用 store 的 `createWorkspace` 方法后，`invalidateCache('workspaces:')` 和 `fetchList()` 会自动执行
- `WorkspaceList` 组件通过 `useWorkspaceStore((s) => s.items)` 订阅数据，数据更新后自动重新渲染

#### 3.2 确保对话创建后工作空间内会话列表刷新

- 检查 `handleConvCreated` 中 `fetchConversations(wsId, true)` 的调用（`true` 表示强制刷新，绕过缓存）
- 确认 `WorkspaceList` 中 `conversationsByWs[ws.id]` 的订阅正确，`useWorkspaceStore((s) => s.conversationsByWs)` 已在组件顶部声明

---

## 架构设计

### 数据流变更（问题1修复后）

```
原流程（有缺陷）：
handleSend() → fetch('/api/workspaces', ...) [直接API调用]
              ↓
              后端创建 workspace（不保存 folderPath）
              ↓
              前端未清除 pending 状态
              ↓
              SWR 缓存未失效，WorkspaceList 不刷新

新流程（修复后）：
handleSend() → useWorkspaceStore.getState().createWorkspace({ name, folderPath })
              ↓
              store 方法调用 API（自动传递 folderPath）
              ↓
              后端创建 workspace（保存 folderPath，去重检查）
              ↓
              store 方法执行 invalidateCache + fetchList
              ↓
              WorkspaceList 自动刷新
              ↓
              handleSend 清除 pending 状态
```

### 目录结构

```
packages/shared/src/
  types.ts                                          [MODIFY] 添加 folderPath 字段
packages/backend/src/core/storage/workspace/
  store.ts                                           [MODIFY] 保存 folderPath，添加去重
packages/frontend/src/stores/
  workspace-store.ts                                 [MODIFY] 传递 folderPath
packages/frontend/src/pages/tasks/
  page.tsx                                           [MODIFY] 使用 store 方法，清除 pending
packages/frontend/src/pages/tasks/components/
  WorkspaceSelector.tsx                              [MODIFY] 添加滚动，移除 slice 限制
```