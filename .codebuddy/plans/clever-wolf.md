# Manta-AI 数据预取与流式渲染升级方案

## Context

Manta-AI 项目当前所有 11 个页面均为 `'use client'` Client Component，数据获取遵循 `useEffect → fetch → setState` 模式，导致页面加载时出现以下 waterfall：

```
HTML 下载 → JS 下载 → React 水合 → useEffect 触发 → fetch 发起 → 数据返回 → 渲染
```

**核心问题**：没有 `loading.tsx` / `error.tsx` 文件（Next.js App Router 的流式渲染完全未启用），Zustand Store 无缓存机制，每次组件挂载都重新 fetch。

**目标**：实现请求与渲染并行，页面加载丝滑，无模块空渲染。

---

## Phase 1：全局 loading.tsx + error.tsx（最高 ROI，零风险）

### 1.1 创建通用骨架屏组件

**新建文件**：`src/app/components/skeleton/SkeletonPage.tsx`

创建轻量骨架屏组件，使用 Tailwind `animate-pulse` + 项目 CSS 变量：
- `SkeletonPage` — 通用页面骨架（标题 + 卡片网格）
- `SkeletonCard` — 单卡片骨架
- `SkeletonList` — 列表项骨架（用于 sidebar）

### 1.2 为所有路由添加 loading.tsx

**新建文件**（共 11 个）：
- `src/app/loading.tsx` — 根级 fallback
- `src/app/tasks/loading.tsx` — 聊天页骨架（侧边栏 + 消息区 + 输入框）
- `src/app/apps/loading.tsx` — 应用卡片网格骨架
- `src/app/apps/[id]/loading.tsx` — 应用详情骨架
- `src/app/apps/[id]/builder/loading.tsx` — 构建器骨架
- `src/app/workspace/loading.tsx` — 工作空间列表骨架
- `src/app/workflow/loading.tsx` — 工作流列表骨架
- `src/app/settings/loading.tsx` — 设置页骨架（左侧目录 + 右侧内容）
- `src/app/mcp/loading.tsx` — MCP 服务器列表骨架
- `src/app/themes/loading.tsx` — 主题页骨架
- `src/app/rag/loading.tsx`、`src/app/evaluation/loading.tsx` — 占位页骨架

**关键规则**：
- `loading.tsx` 必须是 Server Component（不加 `'use client'`）
- 骨架屏结构必须与目标页面的 grid 布局、padding、高度一致，避免 CLS
- 使用 `var(--color-surface)` 和 `var(--color-border)` CSS 变量保持主题一致

### 1.3 为关键路由添加 error.tsx

**新建文件**：
- `src/app/error.tsx` — 全局错误边界（`'use client'`，含重试按钮）
- `src/app/tasks/error.tsx`
- `src/app/apps/error.tsx`
- `src/app/apps/[id]/error.tsx`

**效果**：页面导航时立即展示骨架屏而非白屏等待，Next.js 自动将页面包裹在 `<Suspense>` 中实现 Streaming 渲染。

---

## Phase 2：Store 智能 loading + 请求去重缓存

### 2.1 创建通用 SWR fetch 包装器

**新建文件**：`src/stores/lib/swr-fetch.ts`

实现：
- 请求去重（相同 key 的并发请求只发一次）
- 内存缓存（30 秒内视为新鲜，直接返回缓存）
- stale-while-revalidate（有缓存时不展示 loading，后台静默刷新）

```ts
const inflightRequests = new Map<string, Promise<unknown>>()
const cache = new Map<string, { data: unknown; ts: number }>()
const STALE_MS = 30_000

export async function swrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < STALE_MS) return cached.data as T
  if (inflightRequests.has(key)) return inflightRequests.get(key) as Promise<T>
  const promise = fetcher().then(data => {
    cache.set(key, { data, ts: Date.now() })
    inflightRequests.delete(key)
    return data
  }).catch(err => { inflightRequests.delete(key); throw err })
  inflightRequests.set(key, promise)
  return promise
}

export function invalidateCache(keyPrefix: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) cache.delete(key)
  }
}
```

### 2.2 改造各 Store 的 fetch 方法

**修改文件**：
- `src/stores/app-store.ts` — `fetchApps` 使用 `swrFetch`
- `src/stores/workspace-store.ts` — `fetchList` 使用 `swrFetch`
- `src/stores/conversation-store.ts` — `fetchList` 使用 `swrFetch`
- `src/stores/workflow-store.ts` — `fetchWorkflows` 使用 `swrFetch`
- `src/stores/rag-store.ts` — `fetchKnowledgeBases` 使用 `swrFetch`

**改造模式**（以 `app-store.ts` 为例）：

```ts
// 修改前（第24-25行）:
fetchApps: async (params) => {
  set({ loading: true, error: null })

// 修改后:
fetchApps: async (params) => {
  const hasData = get().apps.length > 0
  if (!hasData) set({ loading: true, error: null }) // 有数据时不阻塞 UI
  const key = `apps:${JSON.stringify(params ?? {})}`
  const json = await swrFetch(key, () =>
    fetch(`/api/apps${qs ? `?${qs}` : ''}`).then(r => r.json())
  )
  // ... 处理响应
```

**Store mutation 后清除缓存**：在 `createApp`、`deleteApp`、`updateApp` 等 mutation 操作后调用 `invalidateCache('apps:')`。

**效果**：
- 页面切换回来时不再重新请求（30 秒内）
- 多个组件同时订阅同一数据时只发一次请求
- 有缓存数据时不展示 loading 骨架屏

---

## Phase 3：Sidebar 数据预取 + 骨架屏优化

### 3.1 Sidebar 骨架屏替换 "加载中..." 文字

**修改文件**：
- `src/app/components/sidebar/ConversationList.tsx` — 第 68-73 行，将 "加载中..." 替换为 5 行列表项骨架
- `src/app/components/sidebar/WorkspaceList.tsx` — 第 114-120 行、第 167-170 行，同样替换

### 3.2 SidebarNav 预触发数据加载

**修改文件**：`src/app/components/SidebarNav.tsx`

在 SidebarNav 的 `useEffect` 中预触发数据加载，不等子组件 effect：

```ts
useEffect(() => {
  useConversationStore.getState().fetchList()
  useWorkspaceStore.getState().fetchList()
}, [])
```

**效果**：Sidebar 数据在组件树最顶层就开始加载，而非等待子组件挂载后各自触发。

---

## Phase 4：页面内 loading 状态优化

### 4.1 替换所有 "加载中..." 纯文字为骨架屏

**修改文件**：
- `src/app/workspace/page.tsx` 第 94 行 — 替换为卡片网格骨架
- `src/app/settings/page.tsx` — 替换各 section 的 loading 文字
- `src/app/apps/[id]/page.tsx` 第 49-55 行 — 替换为详情页骨架
- `src/app/apps/[id]/builder/page.tsx` — 替换为构建器骨架
- `src/app/workflow/page.tsx` — 替换为工作流列表骨架
- `src/app/tasks/page.tsx` 第 1780-1783 行 — 替换 Suspense fallback 为聊天页骨架

### 4.2 Settings 页面并行数据获取

**修改文件**：`src/app/settings/page.tsx`

当前 `useEffect` 中 `probeRunners()` 和 `loadPlugins()` 串行调用。改为 `Promise.allSettled` 并行：

```ts
useEffect(() => {
  // ... localStorage 读取
  Promise.allSettled([probeRunners(), loadPlugins()])
  fetch('/api/readme').then(r => r.json()).then(d => setReadme(d.content ?? '')).finally(...)
}, [])
```

---

## Phase 5：Server Component 数据预取（高级优化）

### 5.1 关键列表页转 Server Component 壳

**策略**：采用"Server Component 壳 + Client Component 内容"分层模式。利用已有的 service 层（`@/core/services/app.service` 等），这些函数是同步的本地文件读取，完美适配 RSC。

**修改文件**：

#### apps 列表页
- `src/app/apps/page.tsx` — 改为 Server Component，调用 `fetchApps()` 预取数据
- 新建 `src/app/apps/AppsPageClient.tsx` — 从原 page.tsx 提取的 Client Component，接收 `initialApps` props

```tsx
// apps/page.tsx — Server Component
import { fetchApps } from '@/core/services/app.service'
import { AppsPageClient } from './AppsPageClient'

export default async function AppsPage() {
  const apps = fetchApps({ sort: 'updatedAt' })
  return <AppsPageClient initialApps={apps} />
}
```

#### workspace 列表页
- `src/app/workspace/page.tsx` — 同样拆分
- 新建 `src/app/workspace/WorkspacePageClient.tsx`

#### workflow 列表页
- `src/app/workflow/page.tsx` — 同样拆分
- 新建 `src/app/workflow/WorkflowPageClient.tsx`

### 5.2 apps/[id] 详情页预取

**修改文件**：
- `src/app/apps/[id]/page.tsx` — 改为 Server Component
- 新建 `src/app/apps/[id]/AppDetailPageClient.tsx`

```tsx
// apps/[id]/page.tsx — Server Component
import { getApp } from '@/core/storage/app/store'
import { notFound } from 'next/navigation'
import { AppDetailPageClient } from './AppDetailPageClient'

export default async function AppDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const app = getApp(id)
  if (!app) notFound()
  return <AppDetailPageClient initialApp={app} />
}
```

### 5.3 Client Component 接收 initialData 模式

**关键模式**：Client Component 通过 props 接收服务端预取的数据，用 `useEffect` 注入 Zustand store：

```tsx
'use client'
export function AppsPageClient({ initialApps }: { initialApps: AppConfig[] }) {
  const { apps, loading, fetchApps } = useAppStore()

  useEffect(() => {
    if (initialApps.length > 0 && apps.length === 0) {
      useAppStore.setState({ apps: initialApps, loading: false })
    }
  }, [])

  // ... 其余原有逻辑不变
}
```

**Hydration 安全保证**：
- `useEffect` 在 hydration 之后执行，不会导致 SSR/CSR 不一致
- 仅在 `apps.length === 0` 时注入，避免覆盖客户端已修改的数据
- Store 的 `fetchXxx` 方法保持不变，用于后续交互刷新

---

## 依赖关系

```
Phase 1 (loading.tsx + error.tsx)     ← 无依赖，立即实施
Phase 2 (Store SWR 缓存)             ← 无依赖，可与 Phase 1 并行
Phase 3 (Sidebar 优化)               ← 依赖 Phase 2 的 swrFetch
Phase 4 (页面 loading 优化)          ← 依赖 Phase 1 的骨架屏组件
Phase 5 (RSC 预取)                   ← 依赖 Phase 2（Store 注入模式）
```

**推荐实施顺序**：Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

---

## 风险与缓解

### 1. Hydration Mismatch
- **风险**：RSC 预取数据与客户端 Store 初始状态不一致
- **缓解**：`useEffect` 注入数据在 hydration 后执行；`suppressHydrationWarning` 已在 layout 中使用

### 2. 布局抖动（CLS）
- **风险**：骨架屏到真实内容切换时 DOM 结构差异导致跳动
- **缓解**：骨架屏严格匹配目标页面的 grid、padding、高度；使用 `min-height` 稳定容器

### 3. 数据不同步
- **风险**：RSC 预取的数据在客户端 mutation 后过期
- **缓解**：SWR 缓存带 stale 标记；mutation 后 `invalidateCache()` 强制刷新；Store 的 `fetchXxx` 保持不变

### 4. Electron 兼容性
- **风险**：RSC 中使用 `window`/`localStorage` 导致报错
- **缓解**：Server Component 仅调用 service 层（纯文件 I/O），不涉及浏览器 API

### 5. tasks 页面复杂度
- **风险**：1789 行巨文件，useChat/SSE 逻辑复杂，改造风险高
- **缓解**：tasks 页面不转 RSC，仅通过 loading.tsx + SWR 缓存优化；Phase 5 跳过此页面

---

## 验证方式

1. **Phase 1 验证**：`npm run dev` 后在浏览器中导航各页面，确认立即出现骨架屏而非白屏
2. **Phase 2 验证**：从 `/apps` 导航到 `/settings` 再返回 `/apps`，确认第二次不出现 loading 状态
3. **Phase 3 验证**：刷新页面后 Sidebar 立即显示骨架列表而非 "加载中..."
4. **Phase 4 验证**：各页面 loading 态均为骨架屏，无纯文字 "加载中..."
5. **Phase 5 验证**：访问 `/apps` 时查看页面源码，确认 HTML 中已包含应用数据（非空壳）
6. **回归验证**：确认无 console 中的 Hydration 错误、无布局抖动、CRUD 操作后数据正确更新
