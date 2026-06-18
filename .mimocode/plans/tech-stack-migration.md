# Manta-AI 技术栈迁移方案

## Context

当前项目使用 Next.js 15.3.0 + App Router + SSR，用户反馈 SSR 带来卡顿和复杂性。目标是将技术栈调整为：
- **前端**: React + Vite（纯客户端渲染）
- **后端**: TypeScript + Express（独立后端服务器）
- **桌面端**: Electron（支持本地/远程两种模式）
- **Web 端**: Docker 容器化部署（私有化部署）

---

## 当前架构分析

| 层级 | 路径 | 依赖 Next.js | 迁移难度 |
|------|------|-------------|----------|
| 核心逻辑 | `src/core/` (83 个文件) | ❌ 无依赖 | 无需迁移 |
| API 路由 | `src/app/api/` (48 个文件) | ✅ 依赖 | 中等 |
| 前端页面 | `src/app/` (12 个页面) | ✅ 依赖 | 中等 |
| 状态管理 | `src/stores/` | ❌ 无依赖 | 无需迁移 |
| Electron | `src/electron/` | ✅ 依赖 | 低 |

**关键发现**: 项目解耦度很高，核心逻辑完全独立于 Next.js。

---

## 目标架构

```
manta-AI/
├── packages/
│   ├── core/           # @manta/core - 核心业务逻辑（从 src/core 迁移）
│   ├── server/         # @manta/server - Express 后端
│   ├── web/            # @manta/web - Vite + React 前端
│   └── desktop/        # @manta/desktop - Electron 客户端
├── docker/
│   ├── Dockerfile.server
│   └── Dockerfile.web
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 实施步骤

### Phase 1: Monorepo 搭建

**目标**: 初始化 Turborepo + pnpm Workspaces

1. 初始化 monorepo 结构
2. 创建 `packages/core`，将 `src/core/` 迁移过去
3. 创建 `pnpm-workspace.yaml` 和 `turbo.json`
4. 配置 TypeScript 项目引用

**关键文件**:
- `pnpm-workspace.yaml`
- `turbo.json`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

---

### Phase 2: 后端重构

**目标**: 将 Next.js API Routes 迁移到 Express

1. 创建 `packages/server`，初始化 Express 项目
2. 将 `src/app/api/` 下的 48 个路由迁移为 Express Router
3. 适配 `src/core/api/error-handler.ts` 为标准 Node Response
4. 实现 SSE 流式传输（替代 Next.js ReadableStream）

**关键修改**:
- `src/app/api/conversations/[id]/ai-stream/route.ts` → `packages/server/src/routes/conversations.ts`
- `src/app/api/chat/stream/route.ts` → `packages/server/src/routes/chat.ts`
- `src/app/api/mcp/servers/route.ts` → `packages/server/src/routes/mcp.ts`

**示例代码**:
```typescript
// packages/server/src/routes/conversations.ts
import { Router } from 'express';
import { fetchConversations } from '@manta/core/services/conversation.service';

const router = Router();

router.get('/', async (req, res) => {
  const { type, workspaceId } = req.query;
  const conversations = fetchConversations({ type, workspaceId });
  res.json({ success: true, data: { conversations } });
});

// SSE 流式聊天
router.post('/:id/ai-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  await runAgentLoop({
    messages: req.body.messages,
    onChunk: (data) => res.write(`data: ${JSON.stringify(data)}\n\n`),
    onDone: () => res.end()
  });
});

export default router;
```

---

### Phase 3: 前端重构

**目标**: 将 Next.js 页面迁移到 Vite + React

1. 创建 `packages/web`，初始化 Vite + React 项目
2. 安装 `react-router-dom`，配置路由
3. 迁移页面组件（12 个页面）
4. 替换 Next.js 特有 API：
   - `next/link` → `<Link to="..." />`
   - `next/image` → `<img />`
   - `next/navigation` → `useNavigate`
   - `process.env.NEXT_PUBLIC_*` → `import.meta.env.VITE_*`

**目录结构**:
```
packages/web/src/
├── components/     # 从 src/app/components 迁移
├── hooks/          # 从 src/app/hooks 迁移
├── pages/          # 对应原 app 下的目录
│   ├── apps/
│   ├── settings/
│   ├── tasks/
│   └── themes/
├── stores/         # 从 src/stores 迁移
├── main.tsx        # Vite 入口
└── App.tsx         # 路由配置
```

**路由映射**:
| 原路径 | 新路径 |
|--------|--------|
| `/tasks` | `/tasks` |
| `/apps` | `/apps` |
| `/settings` | `/settings` |
| `/themes` | `/themes` |

---

### Phase 4: Electron 适配

**目标**: 支持本地/远程两种模式

1. 修改 `src/electron/main.js`，实现双模式连接
2. **本地模式**: Electron 启动时拉起 `@manta/server` 子进程
3. **远程模式**: 用户输入远程地址，直接连接

**关键修改**:
```javascript
// packages/desktop/src/main.js
async function createWindow(mode = 'local', remoteUrl = null) {
  mainWindow = new BrowserWindow({ /* ... */ });

  if (mode === 'local') {
    // 启动本地后端
    serverProcess = spawn('node', ['packages/server/dist/index.js'], {
      env: { ...process.env, PORT: '3001' }
    });
    await waitForServer('http://localhost:3001/health');
    mainWindow.loadURL('http://localhost:5173'); // Vite dev server
  } else {
    // 远程模式
    mainWindow.loadURL(remoteUrl);
  }
}
```

---

### Phase 5: Docker 部署

**目标**: Web 端容器化部署

1. 创建 `docker/Dockerfile.server`（后端容器）
2. 创建 `docker/Dockerfile.web`（前端容器，Nginx 托管）
3. 创建 `docker-compose.yml`

**docker-compose.yml**:
```yaml
version: '3.8'
services:
  server:
    build:
      context: .
      dockerfile: docker/Dockerfile.server
    ports:
      - "3001:3001"
    volumes:
      - manta-data:/app/data

  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web
    ports:
      - "80:80"
    depends_on:
      - server

volumes:
  manta-data:
```

---

## 关键挑战与对策

| 挑战 | 对策 |
|------|------|
| 文件系统存储并发安全 | 引入 `proper-lockfile`（已在依赖中），短期限制单实例部署 |
| SSR 转 CSR 首屏加载 | Vite 代码分割 + 懒加载，私有化部署无需 SEO |
| `src/core` 的 Node.js 兼容性 | 正确保留在后端，前端仅通过 API 调用 |
| 流式传输 SSE | 直接使用 `res.write()` 替代 Next.js ReadableStream |

---

## 迁移顺序建议

1. **Phase 1** (1-2 天): Monorepo 搭建，核心逻辑抽离
2. **Phase 2** (3-5 天): 后端重构，API 迁移
3. **Phase 3** (5-7 天): 前端重构，页面迁移
4. **Phase 4** (2-3 天): Electron 适配
5. **Phase 5** (1-2 天): Docker 部署

**总计**: 约 12-19 天

---

## 验证方案

1. **后端验证**: 启动 Express 服务器，使用 curl/Postman 测试所有 API
2. **前端验证**: 启动 Vite dev server，验证所有页面功能
3. **Electron 验证**: 测试本地模式和远程模式
4. **Docker 验证**: 运行 `docker-compose up`，验证容器化部署

---

## 需要确认的问题

1. 是否需要保留 Next.js 的 ISR/SSG 能力？（建议不需要，私有化部署无需 SEO）
2. 数据库选择：继续使用文件系统还是迁移到 SQLite/PostgreSQL？
3. 是否需要支持多用户/多实例？（当前为单用户模式）
