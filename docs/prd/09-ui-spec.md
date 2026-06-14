# PRD 09 — UI 规范 / UI Specification

---

## 中文版

### 1. 功能概述

UI 规范定义 Manta 平台的**用户界面设计标准**，包括设计系统、页面结构、组件规范和交互模式。本文档确保 UI 开发的一致性和可维护性。

### 2. 设计系统

#### 2.1 设计原则

| 原则 | 说明 | 实践 |
|------|------|------|
| **简洁清晰** | 减少认知负荷 | 每页聚焦一个主要任务 |
| **一致性** | 统一的设计语言 | 相同操作使用相同交互模式 |
| **可发现性** | 功能易于发现 | 清晰的导航和视觉层次 |
| **反馈及时** | 操作有明确反馈 | 加载状态、成功/错误提示 |
| **渐进披露** | 复杂功能分层展示 | 基础功能优先，高级功能可折叠 |

#### 2.2 技术栈

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **前端框架** | Next.js | 15 | 全栈框架 |
| **UI 库** | React | 19 | 组件化开发 |
| **类型系统** | TypeScript | 5.x | 类型安全 |
| **样式** | Tailwind CSS | 4.x | 原子化 CSS |
| **状态管理** | Zustand | 5.x | 轻量级状态管理 |
| **图标** | lucide-react | latest | 图标库 |
| **主题** | CSS Variables | - | 65 套主题支持 |

#### 2.3 颜色系统

```css
:root {
  /* 主色调 */
  --color-primary: #3B82F6;
  --color-primary-hover: #2563EB;
  --color-primary-light: #DBEAFE;
  
  /* 语义颜色 */
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --color-info: #3B82F6;
  
  /* 中性色 */
  --color-gray-50: #F9FAFB;
  --color-gray-100: #F3F4F6;
  --color-gray-200: #E5E7EB;
  --color-gray-300: #D1D5DB;
  --color-gray-400: #9CA3AF;
  --color-gray-500: #6B7280;
  --color-gray-600: #4B5563;
  --color-gray-700: #374151;
  --color-gray-800: #1F2937;
  --color-gray-900: #111827;
  
  /* 背景色 */
  --bg-primary: #FFFFFF;
  --bg-secondary: #F9FAFB;
  --bg-tertiary: #F3F4F6;
  
  /* 文本色 */
  --text-primary: #111827;
  --text-secondary: #4B5563;
  --text-tertiary: #9CA3AF;
  --text-inverse: #FFFFFF;
}
```

#### 2.4 排版系统

```css
/* 字体家族 */
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

/* 字体大小 */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */

/* 行高 */
--leading-tight: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.75;
```

#### 2.5 间距系统

```css
/* 间距 (4px 基准) */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

#### 2.6 圆角系统

```css
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
--radius-2xl: 1rem;     /* 16px */
--radius-full: 9999px;
```

#### 2.7 阴影系统

```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
```

### 3. 页面结构

#### 3.1 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│                        顶部导航栏                            │
│  Logo    应用管理    知识库    工作流    评估中心    设置       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────────────────────────────┐  │
│  │             │  │                                     │  │
│  │   侧边栏    │  │           主内容区                   │  │
│  │   (可选)    │  │                                     │  │
│  │             │  │                                     │  │
│  │             │  │                                     │  │
│  └─────────────┘  └─────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                        底部状态栏 (可选)                      │
└─────────────────────────────────────────────────────────────┘
```

#### 3.2 页面类型

| 页面类型 | 说明 | 示例 |
|---------|------|------|
| **列表页** | 资源列表展示 | 应用列表、知识库列表 |
| **详情页** | 单个资源详情 | 应用详情、知识库详情 |
| **编辑页** | 资源编辑表单 | 应用搭建器、工作流编辑器 |
| **工作区** | 交互式工作环境 | 对话工作空间、评估中心 |
| **设置页** | 配置管理 | 全局设置、应用设置 |

### 4. 核心页面设计

#### 4.1 应用列表页 `/apps`

```typescript
// 页面结构
interface AppsPage {
  header: {
    title: "应用管理"
    actions: ["创建应用"]
  }
  filters: {
    search: string
    status: AppStatus | 'all'
    sort: 'updatedAt' | 'createdAt' | 'name'
  }
  grid: AppCard[]
}

// 应用卡片
interface AppCard {
  id: string
  name: string
  description: string
  icon: string
  status: AppStatus
  lastUpdated: string
  actions: ["打开", "更多操作"]
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│  应用管理                                    [+ 创建应用]  │
├──────────────────────────────────────────────────────────┤
│  ┌── 搜索应用 ────────┐  ┌── 状态筛选 ▼ ──┐  ┌ 排序 ▼ ─┐│
│  └─────────────────────┘  └────────────────┘  └─────────┘│
│                                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│  │ 📄 简历筛选   │ │ 📋 JD生成器   │ │ 💬 客服助手   │     │
│  │ Agent        │ │ Agent        │ │ Agent        │     │
│  │ 已发布  🟢   │ │ 草稿    🟡   │ │ 已发布  🟢   │     │
│  │ 最后编辑 2h前 │ │ 最后编辑 1d前 │ │ 最后编辑 5d前 │     │
│  │              │ │              │ │              │     │
│  │ [打开] [···] │ │ [打开] [···] │ │ [打开] [···] │     │
│  └──────────────┘ └──────────────┘ └──────────────┘     │
└──────────────────────────────────────────────────────────┘
```

#### 4.2 应用搭建器 `/apps/[id]/builder`

```typescript
// 页面结构
interface AppBuilderPage {
  header: {
    back: "返回应用"
    title: "应用搭建器"
    status: AppStatus
    actions: ["保存", "发布"]
  }
  tabs: [
    "基础", "Agent", "知识库", "工作流", "工具", "自动化", "预览"
  ]
  content: TabContent
  preview: PreviewPanel | null
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────────────┐
│  ← 返回应用   应用搭建器    简历筛选 Agent    [草稿]  [保存] [发布] │
├────────┬─────────────────────────────────────────────────────────┤
│  📋 基础 │                                                       │
│  🤖 Agent│    ┌─────────────────────────────────────────────┐    │
│  📚 知识库│    │                                             │    │
│  🔄 工作流│    │          分步配置区域                        │    │
│  🛠️ 工具  │    │          (当前选中 Tab 内容)                  │    │
│  ⚡ 自动化│    │                                             │    │
│  👁️ 预览  │    └─────────────────────────────────────────────┘    │
│         │                                                       │
│         │    右侧实时预览面板(可选折叠)                            │
└────────┴─────────────────────────────────────────────────────────┘
```

#### 4.3 工作空间 `/apps/[id]/workspace`

```typescript
// 页面结构
interface WorkspacePage {
  header: {
    back: "返回应用"
    title: "工作空间 — {appName}"
    actions: ["设置", "更多"]
  }
  sidebar: {
    conversations: Conversation[]
    newConversation: () => void
  }
  main: {
    messages: ConversationMessage[]
    input: MessageInput
  }
  contextPanel: {
    knowledge: KnowledgeBase[]
    tools: string[]
    workDir: string
  }
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│  ← 返回应用   简历筛选 Agent — 工作空间      [设置] [···]  │
├──────────────┬───────────────────────────────────────────┤
│  会话列表     │                                           │
│              │   对话区域                                  │
│  [新建会话]   │   ┌─────────────────────────────────────┐ │
│              │   │ 🤖 你好！我是简历筛选助手。           │ │
│  💬 会话 1    │   │    请上传需要筛选的简历...            │ │
│  💬 会话 2    │   │                                     │ │
│  💬 会话 3    │   │ 👤 请帮我筛选这批简历                │ │
│              │   │                                     │ │
│              │   │ 🤖 好的，我来帮你筛选...             │ │
│              │   │    [调用工具: file_read]              │ │
│              │   │    [检索知识库: 简历模板库]            │ │
│              │   │                                     │ │
│              │   │ ┌─────────────────────────────────┐ │ │
│              │   │ │ 输入消息...          [发送]      │ │ │
│              │   │ └─────────────────────────────────┘ │ │
│              │   └─────────────────────────────────────┘ │
│              │                                           │
│  ────────────│   上下文信息                                │
│  知识库       │   📚 简历模板库 (120 文档)                  │
│  工具         │   🛠️ file_read, web_search                │
│  工作目录     │   📁 /Users/.../resumes                   │
└──────────────┴───────────────────────────────────────────┘
```

#### 4.4 知识库详情页 `/rag/[id]`

```typescript
// 页面结构
interface KnowledgeBasePage {
  header: {
    back: "返回"
    title: "知识库名称"
    actions: ["添加文档", "检索测试", "设置"]
  }
  stats: {
    totalDocuments: number
    totalChunks: number
    vectorDimensions: number
    provider: RagProviderType
    status: 'healthy' | 'error'
  }
  documents: Document[]
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│  ← 返回    简历模板库         [添加文档] [检索测试] [设置]   │
├──────────────────────────────────────────────────────────┤
│  ┌─ 统计 ──────────────────────────────────────────────┐ │
│  │ 总文档: 120  │  总分块: 15,230  │  向量维度: 1536    │ │
│  │ Provider: SQLiteVec  │  状态: 🟢 健康               │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ 文档列表 ──────────────────────────────────────────┐ │
│  │  📄 resume-template-v2.md         ✅ 已索引         │ │
│  │  📄 senior-resume-guide.pdf       ⏳ 处理中...       │ │
│  │  📄 job-requirements.xlsx         ❌ 处理失败        │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

#### 4.5 工作流编辑器 `/workflow/[id]/editor`

```typescript
// 页面结构
interface WorkflowEditorPage {
  header: {
    back: "返回"
    title: "工作流编辑器 — {workflowName}"
    actions: ["保存", "运行"]
  }
  canvas: {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
  }
  sidebar: {
    nodeTypes: WorkflowStepType[]
    properties: NodeProperties
  }
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│  工作流编辑器 — 简历筛选流程                    [保存] [运行] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐          │
│   │  开始    │────▶│ 解析简历 │────▶│ 筛选条件 │          │
│   │         │     │ (agent) │     │(condit.)│          │
│   └─────────┘     └─────────┘     └────┬────┘          │
│                                        │                │
│                          ┌─────────────┴─────────────┐  │
│                          │                           │  │
│                          ▼                           ▼  │
│                   ┌─────────┐                 ┌─────────┐│
│                   │ 人工审核 │                 │ 自动通过 ││
│                   │(human)  │                 │         ││
│                   └────┬────┘                 └────┬────┘│
│                        │                           │    │
│                        └─────────────┬─────────────┘    │
│                                      ▼                  │
│                               ┌─────────┐              │
│                               │  结束    │              │
│                               └─────────┘              │
└──────────────────────────────────────────────────────────┘
```

#### 4.6 评估报告页 `/evaluation/[id]`

```typescript
// 页面结构
interface EvaluationReportPage {
  header: {
    back: "返回"
    title: "评估报告 #{evalId}"
    actions: ["重新评估", "导出"]
  }
  summary: {
    score: number
    maxScore: number
    status: EvaluationStatus
  }
  dimensions: DimensionScore[]
  details: EvaluationDetail[]
}
```

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│  ← 返回    评估报告 #001                                    │
├──────────────────────────────────────────────────────────┤
│  ┌─ 综合得分 ──────────────────────────────────────────┐  │
│  │         ┌──────────────┐                             │  │
│  │         │    86.5      │   综合评分                   │  │
│  │         │   / 100      │                             │  │
│  │         └──────────────┘                             │  │
│  │                                                      │  │
│  │  忠实度: 92%  ████████████░░░░░░                     │  │
│  │  相关性: 88%  ███████████░░░░░░░                     │  │
│  │  精度:   78%  █████████░░░░░░░░░                     │  │
│  │  召回率: 85%  ███████████░░░░░░░                     │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 5. 组件规范

#### 5.1 基础组件

| 组件 | 说明 | 变体 |
|------|------|------|
| **Button** | 按钮 | primary, secondary, outline, ghost, danger |
| **Input** | 输入框 | text, number, email, password, search |
| **Select** | 下拉选择 | single, multiple, searchable |
| **Modal** | 模态框 | small, medium, large, fullscreen |
| **Toast** | 提示消息 | success, error, warning, info |
| **Tooltip** | 工具提示 | top, bottom, left, right |
| **Badge** | 徽章 | default, success, warning, error |
| **Avatar** | 头像 | image, initials, icon |
| **Card** | 卡片 | default, interactive, selected |

#### 5.2 业务组件

| 组件 | 说明 | 用途 |
|------|------|------|
| **AppCard** | 应用卡片 | 应用列表展示 |
| **DocumentItem** | 文档项 | 知识库文档列表 |
| **WorkflowNode** | 工作流节点 | 工作流编辑器 |
| **MessageBubble** | 消息气泡 | 对话界面 |
| **ToolCallCard** | 工具调用卡片 | 对话中的工具调用展示 |
| **MemoryItem** | 记忆项 | 记忆管理列表 |
| **EvaluationChart** | 评估图表 | 评估报告可视化 |
| **StatsCard** | 统计卡片 | 数据统计展示 |

#### 5.3 布局组件

| 组件 | 说明 | 用途 |
|------|------|------|
| **AppShell** | 应用外壳 | 整体布局框架 |
| **Sidebar** | 侧边栏 | 导航菜单 |
| **Header** | 顶部栏 | 页面标题和操作 |
| **Content** | 内容区 | 主要内容展示 |
| **Footer** | 底部栏 | 状态信息 |
| **Grid** | 网格布局 | 卡片列表 |
| **Stack** | 堆叠布局 | 垂直/水平排列 |

### 6. 交互模式

#### 6.1 表单交互

| 场景 | 交互方式 |
|------|---------|
| **输入验证** | 实时验证 + 错误提示 |
| **保存反馈** | Toast 成功/失败提示 |
| **加载状态** | 按钮 loading 状态 |
| **确认操作** | 二次确认弹窗 |
| **自动保存** | 定时自动保存草稿 |

#### 6.2 列表交互

| 场景 | 交互方式 |
|------|---------|
| **分页** | 页码分页 + 加载更多 |
| **搜索** | 实时搜索 + 防抖 |
| **筛选** | 下拉筛选 + 标签筛选 |
| **排序** | 排序下拉 + 排序图标 |
| **批量操作** | 复选框 + 批量操作栏 |

#### 6.3 对话交互

| 场景 | 交互方式 |
|------|---------|
| **发送消息** | Enter 发送 + Shift+Enter 换行 |
| **流式响应** | SSE 流式展示 + 打字机效果 |
| **工具调用** | 折叠展示 + 展开详情 |
| **知识检索** | 检索结果引用展示 |
| **错误处理** | 错误提示 + 重试按钮 |

### 7. 响应式设计

#### 7.1 断点系统

```css
/* 移动端 */
@media (max-width: 639px) { ... }

/* 平板端 */
@media (min-width: 640px) and (max-width: 1023px) { ... }

/* 桌面端 */
@media (min-width: 1024px) { ... }

/* 大屏桌面端 */
@media (min-width: 1280px) { ... }
```

#### 7.2 布局适配

| 页面 | 移动端 | 平板端 | 桌面端 |
|------|--------|--------|--------|
| **应用列表** | 单列 | 双列 | 三列 |
| **应用搭建器** | 全屏标签页 | 左右分栏 | 左右分栏 |
| **工作空间** | 全屏对话 | 左右分栏 | 三栏布局 |
| **知识库详情** | 全屏列表 | 左右分栏 | 左右分栏 |
| **工作流编辑器** | 全屏画布 | 全屏画布 | 画布+侧边栏 |

### 8. 可访问性

#### 8.1 键盘导航

| 操作 | 快捷键 |
|------|--------|
| **导航** | Tab / Shift+Tab |
| **确认** | Enter |
| **取消** | Escape |
| **选择** | Space |
| **搜索** | Ctrl/Cmd + K |

#### 8.2 屏幕阅读器

- 所有交互元素有 `aria-label`
- 图片有 `alt` 属性
- 表单有 `label` 关联
- 状态变化有 `aria-live` 提示

### 9. 性能优化

#### 9.1 加载策略

| 策略 | 说明 | 应用场景 |
|------|------|---------|
| **懒加载** | 按需加载组件 | 路由级别 |
| **虚拟滚动** | 只渲染可见区域 | 长列表 |
| **骨架屏** | 占位加载效果 | 页面初始加载 |
| **预加载** | 提前加载资源 | 关键路径 |

#### 9.2 渲染优化

| 策略 | 说明 | 应用场景 |
|------|------|---------|
| **React.memo** | 避免不必要重渲染 | 纯展示组件 |
| **useMemo** | 缓存计算结果 | 复杂计算 |
| **useCallback** | 缓存函数引用 | 事件处理 |
| **代码分割** | 按路由分割代码 | 路由级别 |

---

## English Version

### 1. Feature Overview

UI Specification defines the **user interface design standards** for the Manta platform, including design system, page structure, component specifications, and interaction patterns.

### 2. Design System

**Design Principles**: Simplicity, Consistency, Discoverability, Feedback, Progressive Disclosure

**Tech Stack**: Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand 5, lucide-react

**Design Tokens**: Colors, Typography, Spacing, Border Radius, Shadows

### 3. Page Types

- **List Pages**: Resource listing (Apps, Knowledge Bases)
- **Detail Pages**: Single resource details
- **Edit Pages**: Resource editing forms (App Builder, Workflow Editor)
- **Workspace Pages**: Interactive environments (Chat, Evaluation)
- **Settings Pages**: Configuration management

### 4. Core Pages

- App List (`/apps`)
- App Builder (`/apps/[id]/builder`) - 7 tabs
- Workspace (`/apps/[id]/workspace`) - Chat interface
- Knowledge Base Detail (`/rag/[id]`)
- Workflow Editor (`/workflow/[id]/editor`) - Visual canvas
- Evaluation Report (`/evaluation/[id]`)

### 5. Component System

**Base Components**: Button, Input, Select, Modal, Toast, Tooltip, Badge, Avatar, Card

**Business Components**: AppCard, DocumentItem, WorkflowNode, MessageBubble, ToolCallCard, MemoryItem, EvaluationChart, StatsCard

### 6. Interaction Patterns

Form validation, list pagination/search/filter, chat streaming, tool call display

### 7. Responsive Design

Breakpoints: Mobile (<640px), Tablet (640-1023px), Desktop (1024px+)

### 8. Accessibility

Keyboard navigation, screen reader support, ARIA attributes

### 9. Performance

Lazy loading, virtual scrolling, skeleton screens, code splitting

---

## 变更记录 / Changelog

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，定义 UI 设计规范和页面结构 |

---

> 上一篇：[PRD 08 — 数据模型](./08-data-model.md)
> 下一篇：[PRD 10 — 开发任务](./10-development-tasks.md)