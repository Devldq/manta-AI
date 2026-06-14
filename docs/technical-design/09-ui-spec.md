# UI 规范技术方案 / UI Specification Technical Design

## 1. 概述

UI规范定义Manta平台的**用户界面设计标准**，包括设计系统、页面结构、组件规范和交互模式。本文档确保UI开发的一致性和可维护性。

### 1.1 设计目标
- **简洁清晰**：减少认知负荷，每页聚焦一个主要任务
- **一致性**：统一的设计语言，相同操作使用相同交互模式
- **可发现性**：功能易于发现，清晰的导航和视觉层次
- **反馈及时**：操作有明确反馈，加载状态、成功/错误提示
- **渐进披露**：复杂功能分层展示，基础功能优先，高级功能可折叠

### 1.2 技术栈
- **前端框架**：Next.js 15
- **UI库**：React 19
- **类型系统**：TypeScript 5.x
- **样式**：Tailwind CSS 4.x
- **状态管理**：Zustand 5.x
- **图标**：lucide-react
- **主题**：CSS Variables，支持65套主题

---

## 2. 设计系统

### 2.1 颜色系统

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

### 2.2 排版系统

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

### 2.3 间距系统

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

### 2.4 圆角系统

```css
--radius-sm: 0.25rem;   /* 4px */
--radius-md: 0.375rem;  /* 6px */
--radius-lg: 0.5rem;    /* 8px */
--radius-xl: 0.75rem;   /* 12px */
--radius-2xl: 1rem;     /* 16px */
--radius-full: 9999px;
```

### 2.5 阴影系统

```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
```

---

## 3. 页面结构

### 3.1 整体布局

```typescript
// 布局组件
interface AppShellProps {
  children: React.ReactNode
  sidebar?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}

// 布局配置
interface LayoutConfig {
  showSidebar: boolean
  showHeader: boolean
  showFooter: boolean
  sidebarWidth: 'sm' | 'md' | 'lg'
  headerHeight: 'sm' | 'md' | 'lg'
}
```

### 3.2 页面类型

| 页面类型 | 说明 | 示例 |
|---------|------|------|
| **列表页** | 资源列表展示 | 应用列表、知识库列表 |
| **详情页** | 单个资源详情 | 应用详情、知识库详情 |
| **编辑页** | 资源编辑表单 | 应用搭建器、工作流编辑器 |
| **工作区** | 交互式工作环境 | 对话工作空间、评估中心 |
| **设置页** | 配置管理 | 全局设置、应用设置 |

---

## 4. 核心页面设计

### 4.1 应用列表页

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

### 4.2 应用搭建器

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

// Tab配置
interface TabConfig {
  id: string
  label: string
  icon: React.ReactNode
  component: React.ComponentType
  validation?: () => ValidationResult
}
```

### 4.3 侧边栏 (Sidebar)

采用极简深色主题设计，功能导航在顶部，会话/工作空间 Tab 在下方。

#### 4.3.1 布局结构

```
┌───────────────────────────────┐
│ ① 顶部操作栏                    │
│ ☰ 🔍         + 新建会话 Ctrl N │
├───────────────────────────────┤
│ ② 功能导航                       │
│ 🤖 智能体应用                    │
│ 🗄 知识库                        │
│ 🔀 工作流                        │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ ③ Tab 切换                       │
│ 会话    工作空间                 │
├───────────────────────────────┤
│ ④ 内容列表（可滚动）            │
│  · 帮我写 React 组件    刚刚    │
│  · 解释 useEffect       10分钟  │
│  · 优化代码性能          1小时  │
├─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ ⑤ 底部用户栏                    │
│ M Manta                  ⚙    │
└───────────────────────────────┘
```

#### 4.3.2 设计配色

| 语义 | 色值 | 用途 |
|------|------|------|
| 背景 | `#18181b` | 侧边栏整体背景 |
| 表面 | `#27272a` | Tab 选中态、分割线 |
| 主文字 | `#fafafa` | 选中项、活跃内容 |
| 次要文字 | `#a1a1aa` | 导航项、默认文字 |
| 辅助文字 | `#52525b` | 时间标签、图标 |
| 品牌色 | `#6366f1` | 选中高亮、强调 |

#### 4.3.3 数据结构

```typescript
// 侧边栏配置
type TabMode = 'conversation' | 'workspace'

interface SidebarConfig {
  mode: TabMode
  // 顶部操作栏
  topBar: {
    menuIcon: 'hamburger'
    searchIcon: 'search'
    createButton: {
      label: string       // 根据 mode 动态切换
      shortcut: 'Ctrl N'
    }
  }
  // 功能导航
  navItems: NavItem[]
  // 内容区
  content: ConversationModeContent | WorkspaceModeContent
  // 底部栏
  bottomBar: {
    avatar: string
    name: string
    settingsIcon: 'settings'
  }
}

interface NavItem {
  id: string
  label: string
  icon: string
  route: string
  badge?: number
}

// 会话模式内容
interface ConversationModeContent {
  mode: 'conversation'
  createLabel: '新建会话'
  conversations: Conversation[]
}

// 工作空间模式内容
interface WorkspaceModeContent {
  mode: 'workspace'
  createLabel: '新建空间'
  workspaces: Workspace[]
}
```

#### 4.3.4 Tab 切换逻辑

```typescript
// Tab 切换控制器
class SidebarTabController {
  private mode: TabMode = 'conversation'
  
  switchTab(mode: TabMode): void {
    this.mode = mode
    this.updateCreateButton()
    this.updateContentList()
  }
  
  private updateCreateButton(): void {
    // 会话模式 → 「新建会话」
    // 工作空间模式 → 「新建空间」
  }
  
  private updateContentList(): void {
    // 会话模式 → 显示 Manta AI 通用对话列表
    // 工作空间模式 → 显示工作空间列表（可展开二级对话）
  }
}
```

#### 4.3.5 前端组件

```tsx
// components/layout/Sidebar.tsx
export function Sidebar() {
  const [mode, setMode] = useState<TabMode>('conversation')
  
  return (
    <aside className="w-60 bg-[#18181b] flex flex-col h-screen">
      {/* ① 顶部操作栏 */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MenuIcon />
          <SearchIcon />
        </div>
        <CreateButton mode={mode} />
      </div>
      
      {/* ② 功能导航 */}
      <div className="px-3 pb-2">
        <NavItem icon="Bot" label="智能体应用" route="/apps" />
        <NavItem icon="Database" label="知识库" route="/rag" />
        <NavItem icon="GitBranch" label="工作流" route="/workflow" />
      </div>
      
      <div className="mx-4 border-t border-[#27272a]" />
      
      {/* ③ Tab 切换 */}
      <div className="px-4 py-2">
        <div className="flex gap-1 text-xs">
          <TabButton label="会话" active={mode === 'conversation'} onClick={() => setMode('conversation')} />
          <TabButton label="工作空间" active={mode === 'workspace'} onClick={() => setMode('workspace')} />
        </div>
      </div>
      
      {/* ④ 内容列表（可滚动） */}
      <div className="flex-1 overflow-auto">
        {mode === 'conversation' ? <ConversationList /> : <WorkspaceList />}
      </div>
      
      {/* ⑤ 底部用户栏 */}
      <div className="px-4 py-2 border-t border-[#27272a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar name="Manta" />
          <span className="text-xs text-[#a1a1aa]">Manta</span>
        </div>
        <SettingsIcon />
      </div>
    </aside>
  )
}

// Tab 按钮组件
function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`px-2 py-1 rounded text-xs ${
        active ? 'bg-[#27272a] text-white font-medium' : 'text-[#52525b] hover:text-[#a1a1aa]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

// 会话列表组件
function ConversationList() {
  const conversations = useConversations()
  return (
    <div className="py-1">
      <SectionHeader title="会话" />
      {conversations.map(conv => (
        <ListItem
          key={conv.id}
          title={conv.title}
          time={conv.lastActiveAt}
          active={conv.isActive}
        />
      ))}
    </div>
  )
}

// 工作空间列表组件（支持二级展开）
function WorkspaceList() {
  const workspaces = useWorkspaces()
  return (
    <div className="py-1">
      <SectionHeader title="工作空间" />
      {workspaces.map(ws => (
        <WorkspaceItem key={ws.id} workspace={ws} />
      ))}
    </div>
  )
}
```

### 4.4 工作空间配置页

```typescript
// 页面结构
interface WorkspaceConfigPage {
  header: {
    title: "工作空间配置"
    actions: ["保存"]
  }
  sections: [
    {
      title: "基本信息"
      fields: ["name", "description"]
    },
    {
      title: "智能体应用"
      component: AgentAppSelector
      description: "选择要在工作空间中使用的智能体应用"
    },
    {
      title: "知识库"
      component: KnowledgeBaseSelector
      description: "选择要绑定的知识库"
    },
    {
      title: "工作流"
      component: WorkflowSelector
      description: "选择要绑定的工作流"
    }
  ]
}

// 智能体应用选择器
interface AgentAppSelector {
  availableApps: AppConfig[]
  selectedApps: string[]
  onChange: (appIds: string[]) => void
}

// 知识库选择器
interface KnowledgeBaseSelector {
  availableKBs: KnowledgeBase[]
  selectedKBs: string[]
  onChange: (kbIds: string[]) => void
}

// 工作流选择器
interface WorkflowSelector {
  availableWorkflows: WorkflowDef[]
  selectedWorkflows: string[]
  onChange: (workflowIds: string[]) => void
}
```

### 4.5 会话页

```typescript
// 页面结构（侧边栏已在 4.3 定义）
interface ConversationPage {
  // 侧边栏：Sidebar 组件（见 4.3）
  sidebar: SidebarConfig
  
  // 对话区域
  chatArea: {
    messages: ConversationMessage[]
    input: MessageInput
    onSend: (message: string) => void
    // @调用相关
    atMention: {
      show: boolean
      apps: AppConfig[]
      onSelect: (app: AppConfig) => void
    }
  }
}
```

### 4.6 知识库详情页

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

### 4.7 工作流编辑器

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

### 4.8 评估报告页

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

---

## 5. 组件规范

### 5.1 基础组件

```typescript
// 按钮组件
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
}

// 输入框组件
interface InputProps {
  type: 'text' | 'number' | 'email' | 'password' | 'search'
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  error?: string
  disabled?: boolean
  icon?: React.ReactNode
}

// 选择框组件
interface SelectProps {
  options: SelectOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  searchable?: boolean
  multiple?: boolean
}

// 模态框组件
interface ModalProps {
  size: 'sm' | 'md' | 'lg' | 'fullscreen'
  title: string
  open: boolean
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}

// 提示消息组件
interface ToastProps {
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

// 徽章组件
interface BadgeProps {
  variant: 'default' | 'success' | 'warning' | 'error' | 'info'
  size: 'sm' | 'md'
  children: React.ReactNode
}

// 卡片组件
interface CardProps {
  variant: 'default' | 'interactive' | 'selected'
  padding: 'sm' | 'md' | 'lg'
  children: React.ReactNode
  onClick?: () => void
}
```

### 5.2 业务组件

```typescript
// 应用卡片组件
interface AppCardProps {
  app: AppConfig
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

// 文档项组件
interface DocumentItemProps {
  document: Document
  onDelete: (id: string) => void
  onProcess: (id: string) => void
}

// 工作流节点组件
interface WorkflowNodeProps {
  node: WorkflowNode
  selected: boolean
  onSelect: (id: string) => void
  onConnect: (sourceId: string, targetId: string) => void
}

// 消息气泡组件
interface MessageBubbleProps {
  message: ConversationMessage
  onRetry?: (id: string) => void
  onCopy?: (content: string) => void
}

// 工具调用卡片组件
interface ToolCallCardProps {
  toolCall: ToolCall
  result?: ToolResult
  expanded: boolean
  onToggle: () => void
}

// 记忆项组件
interface MemoryItemProps {
  memory: MemoryEntry
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

// 评估图表组件
interface EvaluationChartProps {
  dimensions: DimensionScore[]
  type: 'radar' | 'bar' | 'line'
  height?: number
}

// 统计卡片组件
interface StatsCardProps {
  title: string
  value: number | string
  change?: number
  trend?: 'up' | 'down' | 'neutral'
  icon?: React.ReactNode
}

// 会话列表组件
interface ConversationListProps {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

// 会话项组件
interface ConversationItemProps {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

// 消息输入组件
interface MessageInputProps {
  onSend: (message: string) => void
  onAtMention: (query: string) => void
  disabled?: boolean
  placeholder?: string
}

// @提及组件
interface AtMentionProps {
  apps: AppConfig[]
  show: boolean
  onSelect: (app: AppConfig) => void
  onClose: () => void
}

// 工作空间配置表单组件
interface WorkspaceConfigFormProps {
  config: WorkspaceConfig
  onChange: (config: WorkspaceConfig) => void
  onSave: () => void
}
```

### 5.3 布局组件

```typescript
// 应用外壳组件
interface AppShellProps {
  children: React.ReactNode
  sidebar?: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}

// 侧边栏组件
interface SidebarProps {
  items: SidebarItem[]
  activeItem?: string
  onItemClick: (id: string) => void
  collapsed?: boolean
  // 新增：导航项
  navigationItems: [
    { id: 'conversations', label: '会话', icon: MessageSquare },
    { id: 'workspace', label: '工作空间', icon: Settings },
    { id: 'apps', label: '智能体应用', icon: Bot },
    { id: 'rag', label: '知识库', icon: Database },
    { id: 'workflow', label: '工作流', icon: GitBranch }
  ]
}

// 顶部栏组件
interface HeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  back?: {
    label: string
    onClick: () => void
  }
}

// 内容区组件
interface ContentProps {
  children: React.ReactNode
  padding?: 'sm' | 'md' | 'lg'
  scrollable?: boolean
}

// 网格布局组件
interface GridProps {
  columns: number | { sm: number; md: number; lg: number }
  gap: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

// 堆叠布局组件
interface StackProps {
  direction: 'vertical' | 'horizontal'
  spacing: 'sm' | 'md' | 'lg'
  align?: 'start' | 'center' | 'end' | 'stretch'
  children: React.ReactNode
}
```

---

## 6. 交互模式

### 6.1 表单交互

```typescript
// 表单验证
interface FormValidation {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  custom?: (value: any) => boolean | string
}

// 表单状态
interface FormState {
  values: Record<string, any>
  errors: Record<string, string>
  touched: Record<string, boolean>
  isSubmitting: boolean
  isValid: boolean
}

// 表单钩子
function useForm<T>(initialValues: T, validation: FormValidation) {
  const [state, setState] = useState<FormState>({
    values: initialValues,
    errors: {},
    touched: {},
    isSubmitting: false,
    isValid: true
  })
  
  const handleChange = (field: string, value: any) => {
    // 更新值
    // 验证字段
    // 更新错误状态
  }
  
  const handleSubmit = async (onSubmit: (values: T) => Promise<void>) => {
    // 验证所有字段
    // 设置提交状态
    // 调用提交函数
    // 处理成功/失败
  }
  
  return { state, handleChange, handleSubmit }
}
```

### 6.2 列表交互

```typescript
// 列表状态
interface ListState<T> {
  items: T[]
  loading: boolean
  error: string | null
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  filters: Record<string, any>
  sort: {
    field: string
    direction: 'asc' | 'desc'
  }
}

// 列表钩子
function useList<T>(endpoint: string, options?: ListOptions) {
  const [state, setState] = useState<ListState<T>>({
    items: [],
    loading: false,
    error: null,
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    filters: {},
    sort: { field: 'createdAt', direction: 'desc' }
  })
  
  const fetchItems = async () => {
    // 构建查询参数
    // 发起请求
    // 更新状态
  }
  
  const setFilters = (filters: Record<string, any>) => {
    // 更新筛选条件
    // 重新获取数据
  }
  
  const setSort = (field: string, direction: 'asc' | 'desc') => {
    // 更新排序
    // 重新获取数据
  }
  
  const setPage = (page: number) => {
    // 更新页码
    // 重新获取数据
  }
  
  return { state, fetchItems, setFilters, setSort, setPage }
}
```

### 6.3 对话交互

```typescript
// 对话状态
interface ChatState {
  messages: ConversationMessage[]
  loading: boolean
  error: string | null
  streaming: boolean
  currentMessage: string
}

// 对话钩子
function useChat(appId: string, conversationId?: string) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    loading: false,
    error: null,
    streaming: false,
    currentMessage: ''
  })
  
  const sendMessage = async (content: string) => {
    // 添加用户消息
    // 设置加载状态
    // 发送请求
    // 处理流式响应
    // 更新消息列表
  }
  
  const handleStreamResponse = (response: Response) => {
    // 创建SSE连接
    // 监听消息事件
    // 更新当前消息
    // 处理完成事件
    // 处理错误事件
  }
  
  const retryMessage = async (messageId: string) => {
    // 找到失败消息
    // 重新发送
    // 更新消息状态
  }
  
  return { state, sendMessage, retryMessage }
}
```

---

## 7. 响应式设计

### 7.1 断点系统

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

### 7.2 布局适配

```typescript
// 响应式布局配置
interface ResponsiveConfig {
  mobile: LayoutConfig
  tablet: LayoutConfig
  desktop: LayoutConfig
}

// 响应式钩子
function useResponsive() {
  const [breakpoint, setBreakpoint] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')
  
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth
      if (width < 640) {
        setBreakpoint('mobile')
      } else if (width < 1024) {
        setBreakpoint('tablet')
      } else {
        setBreakpoint('desktop')
      }
    }
    
    window.addEventListener('resize', handleResize)
    handleResize()
    
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  return breakpoint
}
```

---

## 8. 可访问性

### 8.1 键盘导航

```typescript
// 键盘快捷键配置
interface KeyboardShortcuts {
  navigation: {
    next: 'Tab'
    previous: 'Shift+Tab'
    confirm: 'Enter'
    cancel: 'Escape'
    select: 'Space'
  }
  global: {
    search: 'Ctrl/Cmd + K'
    newConversation: 'Ctrl/Cmd + N'
    toggleSidebar: 'Ctrl/Cmd + B'
  }
}

// 键盘导航钩子
function useKeyboardNavigation(shortcuts: KeyboardShortcuts) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查快捷键
      // 执行对应操作
      // 阻止默认行为
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
```

### 8.2 屏幕阅读器

```typescript
// ARIA属性配置
interface AriaConfig {
  label?: string
  describedBy?: string
  expanded?: boolean
  selected?: boolean
  disabled?: boolean
  hidden?: boolean
  live?: 'off' | 'polite' | 'assertive'
  role?: string
}

// 可访问性钩子
function useAccessibility(config: AriaConfig) {
  const ariaProps: Record<string, any> = {}
  
  if (config.label) ariaProps['aria-label'] = config.label
  if (config.describedBy) ariaProps['aria-describedby'] = config.describedBy
  if (config.expanded !== undefined) ariaProps['aria-expanded'] = config.expanded
  if (config.selected !== undefined) ariaProps['aria-selected'] = config.selected
  if (config.disabled !== undefined) ariaProps['aria-disabled'] = config.disabled
  if (config.hidden !== undefined) ariaProps['aria-hidden'] = config.hidden
  if (config.live) ariaProps['aria-live'] = config.live
  if (config.role) ariaProps['role'] = config.role
  
  return ariaProps
}
```

---

## 9. 性能优化

### 9.1 加载策略

```typescript
// 懒加载配置
interface LazyLoadConfig {
  threshold?: number
  rootMargin?: string
  triggerOnce?: boolean
}

// 懒加载钩子
function useLazyLoad(config?: LazyLoadConfig) {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLElement>(null)
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          if (config?.triggerOnce) {
            observer.disconnect()
          }
        }
      },
      {
        threshold: config?.threshold || 0,
        rootMargin: config?.rootMargin || '0px'
      }
    )
    
    if (ref.current) {
      observer.observe(ref.current)
    }
    
    return () => observer.disconnect()
  }, [config])
  
  return { ref, isVisible }
}

// 虚拟滚动配置
interface VirtualScrollConfig {
  itemHeight: number
  overscan?: number
  scrollingDelay?: number
}

// 虚拟滚动钩子
function useVirtualScroll<T>(items: T[], config: VirtualScrollConfig) {
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  
  const visibleItems = useMemo(() => {
    const startIndex = Math.floor(scrollTop / config.itemHeight)
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / config.itemHeight) + (config.overscan || 5),
      items.length
    )
    
    return items.slice(startIndex, endIndex).map((item, index) => ({
      item,
      index: startIndex + index,
      style: {
        position: 'absolute' as const,
        top: (startIndex + index) * config.itemHeight,
        height: config.itemHeight
      }
    }))
  }, [items, scrollTop, containerHeight, config])
  
  const totalHeight = items.length * config.itemHeight
  
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])
  
  return { visibleItems, totalHeight, handleScroll, setContainerHeight }
}
```

### 9.2 渲染优化

```typescript
// React.memo包装
const MemoizedComponent = React.memo(MyComponent, (prevProps, nextProps) => {
  // 自定义比较逻辑
  return prevProps.id === nextProps.id && prevProps.name === nextProps.name
})

// useMemo缓存计算结果
function ExpensiveComponent({ data }: { data: any[] }) {
  const processedData = useMemo(() => {
    return data.map(item => ({
      ...item,
      computed: expensiveComputation(item)
    }))
  }, [data])
  
  return <div>{/* 渲染processedData */}</div>
}

// useCallback缓存函数引用
function ParentComponent() {
  const [count, setCount] = useState(0)
  
  const handleClick = useCallback(() => {
    setCount(prev => prev + 1)
  }, [])
  
  return <ChildComponent onClick={handleClick} />
}
```

---

## 10. 实现计划

### 10.1 第一阶段：设计系统（1周）
1. 定义颜色、排版、间距等设计令牌
2. 实现基础组件库
3. 创建主题系统
4. 完成设计文档

### 10.2 第二阶段：页面实现（3周）
1. 实现应用列表页
2. 实现应用搭建器
3. 实现工作空间
4. 实现知识库详情页
5. 实现工作流编辑器
6. 实现评估报告页

### 10.3 第三阶段：优化与测试（1周）
1. 响应式适配
2. 可访问性优化
3. 性能优化
4. 用户测试

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于PRD 09创建 |
| 2026-06-14 | v1.1 | 更新为侧边栏布局，添加工作空间配置页和会话页，添加相关组件 |
| 2026-06-14 | v1.2 | 新增侧边栏完整设计规范（4.3），极简深色风格，功能导航在顶部，Tab切换会话/工作空间 |

---

> 上一篇：[08-data-model.md](./08-data-model.md)
> 下一篇：[10-development-tasks.md](./10-development-tasks.md)