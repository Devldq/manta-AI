# Manta-AI 技术栈迁移计划

## 迁移目标
从 Next.js SSR 迁移到 React + Vite + Fastify 架构，确保所有业务逻辑完整迁移且能正常运行。

## 迁移优先级（按依赖关系排序）

### Phase 1: 核心数据模型和类型定义 ✅
- [x] 迁移 `src/core/types.ts` 到 `packages/core/src/types.ts`
- [x] 导出所有类型定义

### Phase 2: 存储层迁移
- [ ] 迁移 `src/core/storage/` 到 `packages/core/src/storage/`
- [ ] 适配文件系统操作（移除 Next.js 依赖）
- [ ] 实现通用存储接口

### Phase 3: 服务层迁移
- [ ] 迁移 `src/core/services/conversation.service.ts`
- [ ] 迁移 `src/core/services/app.service.ts`
- [ ] 迁移 `src/core/services/workspace.service.ts`
- [ ] 移除 Next.js 特定依赖

### Phase 4: 工具和引擎迁移
- [ ] 迁移 `src/core/tools/` 工具注册系统
- [ ] 迁移 `src/core/engine/` 执行引擎
- [ ] 迁移 `src/core/context/` 上下文管理

### Phase 5: Server 路由更新
- [ ] 更新所有路由调用真实服务
- [ ] 实现错误处理和响应格式

### Phase 6: 前端组件集成
- [ ] 确保前端能正确调用后端 API
- [ ] 测试完整功能流程

## 详细执行步骤

### Step 1: 迁移存储层
```typescript
// packages/core/src/storage/index.ts
export * from './conversation-store'
export * from './app-store'
export * from './workspace-store'
```

### Step 2: 迁移服务层
```typescript
// packages/core/src/services/conversation.service.ts
import { conversationStore } from '../storage'

export const conversationService = {
  async list() { ... },
  async get(id: string) { ... },
  async create(data: CreateConversationDTO) { ... },
  async update(id: string, data: UpdateConversationDTO) { ... },
  async delete(id: string) { ... }
}
```

### Step 3: 更新 Server 路由
```typescript
// packages/server/src/routes/conversations.ts
import { conversationService } from '@manta/core'

fastify.get('/', async (request, reply) => {
  const conversations = await conversationService.list()
  return { success: true, data: conversations }
})
```

### Step 4: 集成测试
- 测试存储层 CRUD 操作
- 测试服务层业务逻辑
- 测试 API 路由响应
- 测试前端组件调用

## 预期结果
- 所有业务逻辑完整迁移
- 前后端正常通信
- 功能完整性验证通过
