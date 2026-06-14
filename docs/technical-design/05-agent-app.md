# 智能体应用技术方案 / Agent Application Technical Design

## 1. 概述

智能体应用是Manta平台的**核心产品形态**，每个应用都是一个独立的产品，绑定知识库、工具、工作流，运行在自己的工作空间中。本文档详细描述智能体应用模块的技术实现方案。

### 1.1 设计目标
- **Agent as Application**：每个Agent都是一个产品
- **配置驱动**：通过配置定义应用行为
- **生命周期管理**：支持草稿、发布、归档状态
- **模块化绑定**：灵活绑定知识库、工具、工作流

### 1.2 核心概念
- **AppConfig**：应用配置，包含所有绑定关系
- **AgentOverride**：Agent参数覆盖
- **RagBinding**：知识库绑定配置
- **Automation**：自动化任务配置
- **AppBuilder**：应用搭建器，可视化配置界面

---

## 2. 应用配置

### 2.1 数据结构

```typescript
// 应用状态
type AppStatus = 'draft' | 'published' | 'archived'

// Agent 参数覆盖
interface AgentOverride {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  model?: string
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

// RAG 知识库绑定
interface RagBinding {
  knowledgeBaseId: string
  topK: number
  similarityThreshold: number
  hybridSearchEnabled: boolean
  vectorWeight: number
  rerankEnabled?: boolean
  rerankModel?: string
}

// 自动化任务
interface Automation {
  id: string
  type: 'cron' | 'webhook' | 'manual'
  name: string
  description?: string
  enabled: boolean
  cronExpression?: string
  timezone?: string
  webhookUrl?: string
  webhookSecret?: string
  templateMessage?: string
  createdAt: string
  updatedAt: string
  lastTriggeredAt?: string
  nextTriggerAt?: string
}

// 应用配置
interface AppConfig {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  status: AppStatus

  // Agent 绑定
  agentId: string
  agentOverride: AgentOverride

  // 知识库绑定
  ragBinding: RagBinding | null

  // 工作流绑定
  workflowId?: string

  // 启用的工具
  enabledTools: string[]

  // 自动化
  automations: Automation[]

  // 时间戳
  createdAt: string
  updatedAt: string
  publishedAt: string | null

  // 版本号（乐观锁）
  version: number
}
```

### 2.2 配置验证器

```typescript
class AppConfigValidator {
  validate(config: AppConfig): ValidationResult {
    const errors: ValidationError[] = []
    
    // 基础字段验证
    if (!config.name || config.name.trim().length === 0) {
      errors.push({ field: 'name', message: '应用名称不能为空' })
    }
    
    if (config.name.length > 100) {
      errors.push({ field: 'name', message: '应用名称不能超过100个字符' })
    }
    
    if (!config.description || config.description.trim().length === 0) {
      errors.push({ field: 'description', message: '应用描述不能为空' })
    }
    
    // Agent绑定验证
    if (!config.agentId) {
      errors.push({ field: 'agentId', message: '必须选择一个Agent' })
    }
    
    // Agent覆盖参数验证
    if (config.agentOverride) {
      const { temperature, maxTokens, topP } = config.agentOverride
      
      if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
        errors.push({ field: 'agentOverride.temperature', message: 'Temperature必须在0-2之间' })
      }
      
      if (maxTokens !== undefined && (maxTokens < 1 || maxTokens > 128000)) {
        errors.push({ field: 'agentOverride.maxTokens', message: 'MaxTokens必须在1-128000之间' })
      }
      
      if (topP !== undefined && (topP < 0 || topP > 1)) {
        errors.push({ field: 'agentOverride.topP', message: 'TopP必须在0-1之间' })
      }
    }
    
    // RAG绑定验证
    if (config.ragBinding) {
      const { topK, similarityThreshold, vectorWeight } = config.ragBinding
      
      if (topK < 1 || topK > 20) {
        errors.push({ field: 'ragBinding.topK', message: 'TopK必须在1-20之间' })
      }
      
      if (similarityThreshold < 0 || similarityThreshold > 1) {
        errors.push({ field: 'ragBinding.similarityThreshold', message: '相似度阈值必须在0-1之间' })
      }
      
      if (vectorWeight < 0 || vectorWeight > 1) {
        errors.push({ field: 'ragBinding.vectorWeight', message: '向量权重必须在0-1之间' })
      }
    }
    
    // 自动化任务验证
    for (const automation of config.automations) {
      if (automation.type === 'cron' && !automation.cronExpression) {
        errors.push({ field: 'automations.cronExpression', message: 'Cron任务必须设置cron表达式' })
      }
      
      if (automation.type === 'webhook' && !automation.webhookUrl) {
        errors.push({ field: 'automations.webhookUrl', message: 'Webhook任务必须设置webhook URL' })
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
}
```

---

## 3. 应用生命周期

### 3.1 状态机

```typescript
class AppStateMachine {
  private transitions: Map<string, string[]> = new Map([
    ['draft', ['published', 'archived']],
    ['published', ['draft', 'archived']],
    ['archived', ['draft']]
  ])
  
  canTransition(from: AppStatus, to: AppStatus): boolean {
    const allowed = this.transitions.get(from)
    return allowed ? allowed.includes(to) : false
  }
  
  async transition(app: AppConfig, to: AppStatus): Promise<AppConfig> {
    if (!this.canTransition(app.status, to)) {
      throw new Error(`Invalid transition from ${app.status} to ${to}`)
    }
    
    const updated = {
      ...app,
      status: to,
      updatedAt: new Date().toISOString(),
      version: app.version + 1
    }
    
    // 发布时记录发布时间
    if (to === 'published') {
      updated.publishedAt = new Date().toISOString()
    }
    
    return updated
  }
}
```

### 3.2 生命周期事件

```typescript
class AppLifecycleManager {
  private eventEmitter: EventEmitter
  
  constructor() {
    this.eventEmitter = new EventEmitter()
    this.registerEventHandlers()
  }
  
  private registerEventHandlers(): void {
    this.eventEmitter.on('app:created', this.handleAppCreated.bind(this))
    this.eventEmitter.on('app:published', this.handleAppPublished.bind(this))
    this.eventEmitter.on('app:archived', this.handleAppArchived.bind(this))
    this.eventEmitter.on('app:deleted', this.handleAppDeleted.bind(this))
  }
  
  private async handleAppCreated(app: AppConfig): Promise<void> {
    // 创建默认工作空间
    await workspaceService.create(app.id, {
      name: `${app.name} - 工作空间`,
      appId: app.id
    })
    
    // 初始化默认配置
    await this.initializeDefaultConfig(app)
  }
  
  private async handleAppPublished(app: AppConfig): Promise<void> {
    // 验证配置完整性
    const validation = configValidator.validate(app)
    if (!validation.valid) {
      throw new Error('应用配置不完整，无法发布')
    }
    
    // 检查依赖资源是否存在
    await this.validateDependencies(app)
    
    // 启用自动化任务
    await this.enableAutomations(app)
    
    // 发布事件
    await this.logActivity(app.id, 'published', '应用已发布')
  }
  
  private async handleAppArchived(app: AppConfig): Promise<void> {
    // 禁用自动化任务
    await this.disableAutomations(app)
    
    // 归档事件
    await this.logActivity(app.id, 'archived', '应用已归档')
  }
  
  private async handleAppDeleted(app: AppConfig): Promise<void> {
    // 清理资源
    await this.cleanupResources(app)
    
    // 删除工作空间
    await workspaceService.delete(app.id)
    
    // 删除事件
    await this.logActivity(app.id, 'deleted', '应用已删除')
  }
}
```

---

## 4. 应用搭建器

### 4.1 搭建器架构

```typescript
class AppBuilder {
  private config: AppConfig
  private validator: AppConfigValidator
  private previewService: PreviewService
  
  constructor(initialConfig?: AppConfig) {
    this.config = initialConfig || this.createDefaultConfig()
    this.validator = new AppConfigValidator()
    this.previewService = new PreviewService()
  }
  
  private createDefaultConfig(): AppConfig {
    return {
      id: generateId(),
      name: '',
      description: '',
      icon: '🤖',
      tags: [],
      status: 'draft',
      agentId: '',
      agentOverride: {},
      ragBinding: null,
      enabledTools: [],
      automations: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
      version: 1
    }
  }
  
  // 更新基础信息
  updateBasics(basics: Partial<AppConfig>): void {
    this.config = {
      ...this.config,
      ...basics,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 更新Agent配置
  updateAgent(agentId: string, override: AgentOverride): void {
    this.config = {
      ...this.config,
      agentId,
      agentOverride: override,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 更新RAG绑定
  updateRagBinding(binding: RagBinding | null): void {
    this.config = {
      ...this.config,
      ragBinding: binding,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 更新工作流绑定
  updateWorkflow(workflowId: string | undefined): void {
    this.config = {
      ...this.config,
      workflowId,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 更新工具列表
  updateTools(tools: string[]): void {
    this.config = {
      ...this.config,
      enabledTools: tools,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 更新自动化任务
  updateAutomations(automations: Automation[]): void {
    this.config = {
      ...this.config,
      automations,
      updatedAt: new Date().toISOString()
    }
  }
  
  // 验证当前配置
  validate(): ValidationResult {
    return this.validator.validate(this.config)
  }
  
  // 获取预览
  async getPreview(): Promise<PreviewResult> {
    return this.previewService.preview(this.config)
  }
  
  // 保存配置
  async save(): Promise<AppConfig> {
    const validation = this.validate()
    if (!validation.valid) {
      throw new ValidationError('配置验证失败', validation.errors)
    }
    
    return appService.save(this.config)
  }
  
  // 发布应用
  async publish(): Promise<AppConfig> {
    const validation = this.validate()
    if (!validation.valid) {
      throw new ValidationError('配置验证失败', validation.errors)
    }
    
    return appService.publish(this.config.id)
  }
}
```

### 4.2 预览服务

```typescript
class PreviewService {
  async preview(config: AppConfig): Promise<PreviewResult> {
    // 加载Agent配置
    const agent = await agentService.getAgent(config.agentId)
    if (!agent) {
      return { success: false, error: 'Agent不存在' }
    }
    
    // 合并Agent配置
    const mergedConfig = this.mergeAgentConfig(agent, config.agentOverride)
    
    // 加载知识库信息
    let ragInfo = null
    if (config.ragBinding) {
      const kb = await knowledgeBaseService.getById(config.ragBinding.knowledgeBaseId)
      ragInfo = {
        name: kb?.name,
        documentCount: kb?.stats.documentCount,
        chunkCount: kb?.stats.chunkCount
      }
    }
    
    // 加载工作流信息
    let workflowInfo = null
    if (config.workflowId) {
      const workflow = await workflowService.getById(config.workflowId)
      workflowInfo = {
        name: workflow?.name,
        stepCount: workflow?.steps.length
      }
    }
    
    return {
      success: true,
      preview: {
        agent: {
          name: agent.name,
          model: mergedConfig.model,
          systemPrompt: mergedConfig.systemPrompt
        },
        rag: ragInfo,
        workflow: workflowInfo,
        tools: config.enabledTools,
        automations: config.automations.filter(a => a.enabled).length
      }
    }
  }
  
  private mergeAgentConfig(agent: Agent, override: AgentOverride): AgentConfig {
    return {
      ...agent.config,
      ...override
    }
  }
}
```

---

## 5. API 实现

### 5.1 API 路由

```typescript
// app/api/apps/route.ts
export async function GET() {
  const apps = await appService.list()
  return NextResponse.json(apps)
}

export async function POST(request: Request) {
  const body = await request.json()
  const app = await appService.create(body)
  return NextResponse.json(app, { status: 201 })
}

// app/api/apps/[id]/route.ts
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const app = await appService.getById(params.id)
  if (!app) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json(app)
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json()
  const app = await appService.update(params.id, body)
  return NextResponse.json(app)
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  await appService.delete(params.id)
  return NextResponse.json({ success: true })
}

// app/api/apps/[id]/clone/route.ts
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const app = await appService.clone(params.id)
  return NextResponse.json(app, { status: 201 })
}

// app/api/apps/[id]/status/route.ts
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { status } = await request.json()
  const app = await appService.updateStatus(params.id, status)
  return NextResponse.json(app)
}
```

### 5.2 服务层实现

```typescript
class AppService {
  private db: Database
  private stateMachine: AppStateMachine
  private lifecycleManager: AppLifecycleManager
  
  async create(data: CreateAppDTO): Promise<AppConfig> {
    const id = generateId()
    const app: AppConfig = {
      id,
      name: data.name,
      description: data.description || '',
      icon: data.icon || '🤖',
      tags: data.tags || [],
      status: 'draft',
      agentId: data.agentId,
      agentOverride: data.agentOverride || {},
      ragBinding: data.ragBinding || null,
      enabledTools: data.enabledTools || [],
      automations: data.automations || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: null,
      version: 1
    }
    
    // 保存到数据库
    await this.saveToDatabase(app)
    
    // 触发生命周期事件
    await this.lifecycleManager.emit('app:created', app)
    
    return app
  }
  
  async update(id: string, data: UpdateAppDTO): Promise<AppConfig> {
    const existing = await this.getById(id)
    if (!existing) {
      throw new NotFoundError('App')
    }
    
    // 检查版本冲突（乐观锁）
    if (data.version && data.version !== existing.version) {
      throw new ConflictError('应用已被其他人修改，请刷新后重试')
    }
    
    const updated = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1
    }
    
    // 验证配置
    const validation = configValidator.validate(updated)
    if (!validation.valid) {
      throw new ValidationError('配置验证失败', validation.errors)
    }
    
    // 保存到数据库
    await this.saveToDatabase(updated)
    
    return updated
  }
  
  async publish(id: string): Promise<AppConfig> {
    const app = await this.getById(id)
    if (!app) {
      throw new NotFoundError('App')
    }
    
    // 状态转换
    const published = await this.stateMachine.transition(app, 'published')
    
    // 保存到数据库
    await this.saveToDatabase(published)
    
    // 触发生命周期事件
    await this.lifecycleManager.emit('app:published', published)
    
    return published
  }
  
  async clone(id: string): Promise<AppConfig> {
    const original = await this.getById(id)
    if (!original) {
      throw new NotFoundError('App')
    }
    
    const cloned = {
      ...original,
      id: generateId(),
      name: `${original.name} (副本)`,
      status: 'draft' as AppStatus,
      publishedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    }
    
    // 保存到数据库
    await this.saveToDatabase(cloned)
    
    // 触发生命周期事件
    await this.lifecycleManager.emit('app:created', cloned)
    
    return cloned
  }
  
  async delete(id: string): Promise<void> {
    const app = await this.getById(id)
    if (!app) {
      throw new NotFoundError('App')
    }
    
    // 检查是否可以删除
    if (app.status === 'published') {
      throw new Error('不能删除已发布的应用，请先归档')
    }
    
    // 从数据库删除
    await this.deleteFromDatabase(id)
    
    // 触发生命周期事件
    await this.lifecycleManager.emit('app:deleted', app)
  }
}
```

---

## 6. 前端组件设计

### 6.1 应用搭建器组件

```tsx
// components/apps/AppBuilder.tsx
export function AppBuilder({ appId }: { appId?: string }) {
  const [builder, setBuilder] = useState<AppBuilder | null>(null)
  const [activeTab, setActiveTab] = useState('basics')
  const [isDirty, setIsDirty] = useState(false)
  
  useEffect(() => {
    if (appId) {
      loadApp(appId).then(app => {
        setBuilder(new AppBuilder(app))
      })
    } else {
      setBuilder(new AppBuilder())
    }
  }, [appId])
  
  const handleSave = async () => {
    if (!builder) return
    
    try {
      await builder.save()
      setIsDirty(false)
      toast.success('保存成功')
    } catch (error) {
      toast.error('保存失败: ' + error.message)
    }
  }
  
  const handlePublish = async () => {
    if (!builder) return
    
    try {
      await builder.publish()
      toast.success('发布成功')
    } catch (error) {
      toast.error('发布失败: ' + error.message)
    }
  }
  
  const tabs = [
    { id: 'basics', label: '基础', icon: FileText },
    { id: 'agent', label: 'Agent', icon: Bot },
    { id: 'knowledge', label: '知识库', icon: BookOpen },
    { id: 'workflow', label: '工作流', icon: GitBranch },
    { id: 'tools', label: '工具', icon: Wrench },
    { id: 'automation', label: '自动化', icon: Zap },
    { id: 'preview', label: '预览', icon: Eye }
  ]
  
  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <div className="w-48 border-r bg-muted/30 p-4">
        <h2 className="font-semibold mb-4">配置</h2>
        <nav className="space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      
      {/* 主内容区 */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">
            {builder?.config.name || '新建应用'}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSave} disabled={!isDirty}>
              保存
            </Button>
            <Button onClick={handlePublish}>
              发布
            </Button>
          </div>
        </div>
        
        {activeTab === 'basics' && (
          <BasicsTab 
            config={builder?.config} 
            onChange={(updates) => {
              builder?.updateBasics(updates)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'agent' && (
          <AgentTab
            agentId={builder?.config.agentId}
            override={builder?.config.agentOverride}
            onChange={(agentId, override) => {
              builder?.updateAgent(agentId, override)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'knowledge' && (
          <KnowledgeTab
            binding={builder?.config.ragBinding}
            onChange={(binding) => {
              builder?.updateRagBinding(binding)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'workflow' && (
          <WorkflowTab
            workflowId={builder?.config.workflowId}
            onChange={(workflowId) => {
              builder?.updateWorkflow(workflowId)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'tools' && (
          <ToolsTab
            tools={builder?.config.enabledTools}
            onChange={(tools) => {
              builder?.updateTools(tools)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'automation' && (
          <AutomationTab
            automations={builder?.config.automations}
            onChange={(automations) => {
              builder?.updateAutomations(automations)
              setIsDirty(true)
            }}
          />
        )}
        
        {activeTab === 'preview' && (
          <PreviewTab builder={builder} />
        )}
      </div>
    </div>
  )
}
```

### 6.2 应用列表组件

```tsx
// components/apps/AppList.tsx
export function AppList() {
  const { data: apps, isLoading } = useSWR('/api/apps', fetcher)
  const [statusFilter, setStatusFilter] = useState<AppStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  if (isLoading) return <LoadingSkeleton />
  
  const filteredApps = apps?.filter(app => {
    if (statusFilter !== 'all' && app.status !== statusFilter) return false
    if (searchQuery && !app.name.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">应用管理</h1>
        <Button asChild>
          <Link href="/apps/new">创建应用</Link>
        </Button>
      </div>
      
      <div className="flex gap-4">
        <Input
          placeholder="搜索应用..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="published">已发布</SelectItem>
            <SelectItem value="archived">已归档</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredApps?.map(app => (
          <AppCard key={app.id} app={app} />
        ))}
      </div>
    </div>
  )
}

// components/apps/AppCard.tsx
export function AppCard({ app }: { app: AppConfig }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-2xl">{app.icon}</span>
          <span>{app.name}</span>
        </CardTitle>
        <CardDescription>{app.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-4">
          <Badge variant={getStatusVariant(app.status)}>
            {app.status === 'draft' && '草稿'}
            {app.status === 'published' && '已发布'}
            {app.status === 'archived' && '已归档'}
          </Badge>
          {app.tags.map(tag => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
        </div>
        
        <div className="text-sm text-muted-foreground space-y-1">
          <p>最后编辑: {formatDateTime(app.updatedAt)}</p>
          {app.publishedAt && <p>发布时间: {formatDateTime(app.publishedAt)}</p>}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/apps/${app.id}`}>打开</Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem asChild>
              <Link href={`/apps/${app.id}/edit`}>编辑</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>复制</DropdownMenuItem>
            {app.status === 'published' && (
              <DropdownMenuItem>归档</DropdownMenuItem>
            )}
            {app.status === 'draft' && (
              <DropdownMenuItem className="text-red-600">删除</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  )
}
```

---

## 7. 错误处理

### 7.1 错误类型

```typescript
export class AppNotFoundError extends Error {
  constructor(id: string) {
    super(`App not found: ${id}`)
    this.name = 'AppNotFoundError'
  }
}

export class InvalidAppConfigError extends Error {
  constructor(errors: ValidationError[]) {
    super(`Invalid app configuration: ${errors.map(e => e.message).join(', ')}`)
    this.name = 'InvalidAppConfigError'
    this.errors = errors
  }
}

export class AppConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppConflictError'
  }
}

export class AppTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid state transition from ${from} to ${to}`)
    this.name = 'AppTransitionError'
  }
}
```

### 7.2 错误处理中间件

```typescript
export function appErrorHandler(error: Error): NextResponse {
  console.error('App Error:', error)
  
  if (error instanceof AppNotFoundError) {
    return NextResponse.json({
      error: 'Not found',
      message: error.message
    }, { status: 404 })
  }
  
  if (error instanceof InvalidAppConfigError) {
    return NextResponse.json({
      error: 'Invalid configuration',
      message: error.message,
      errors: error.errors
    }, { status: 400 })
  }
  
  if (error instanceof AppConflictError) {
    return NextResponse.json({
      error: 'Conflict',
      message: error.message
    }, { status: 409 })
  }
  
  return NextResponse.json({
    error: 'Internal server error',
    message: 'An unexpected error occurred'
  }, { status: 500 })
}
```

---

## 8. 实现计划

### 8.1 第一阶段：基础功能（2周）
1. 实现应用配置数据结构
2. 实现应用CRUD API
3. 实现状态机和生命周期管理
4. 完成应用列表和详情页

### 8.2 第二阶段：搭建器（2周）
1. 实现应用搭建器框架
2. 实现各个配置Tab组件
3. 实现配置验证和预览
4. 添加保存和发布功能

### 8.3 第三阶段：增强功能（1周）
1. 实现应用复制功能
2. 添加搜索和筛选
3. 优化错误处理
4. 完善文档和示例

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|---------|
| 2026-06-14 | v1.0 | 初始版本，基于PRD 05创建 |

---

> 上一篇：[04-workflow.md](./04-workflow.md)
> 下一篇：[06-evaluation.md](./06-evaluation.md)