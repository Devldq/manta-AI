/*  start: Manta 核心类型定义 — 所有模块共享，单向依赖（不导入任何内部模块）*/

// ─── 任务状态机 ───────────────────────────────────────────────
export type TaskStatus =
  | 'inbox'      // 待处理（初始状态）
  | 'planning'   // 规划中（工作流分配中）
  | 'running'    // 进行中（Agent 执行中）
  | 'done'       // 已完成
  | 'failed'     // 失败
  | 'archived'   // 已归档

// ─── 任务模式 ───────────────────────────────────────────────
export type TaskMode =
  | 'lightweight'  // 轻量模式：Task → Runner → 结果（无工作流）
  | 'workflow'     // 完整模式：Task → Workflow → Runner

// ─── 任务对象 ───────────────────────────────────────────────
export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  mode: TaskMode

  // 轻量模式：直接指定 Agent
  agentName?: string

  // 完整模式：工作流
  workflowId?: string
  currentStepId?: string
  workflowContext?: Record<string, unknown>

  // AI: 工作目录（可选，指定 Agent 在哪个文件夹下执行任务）
  workDir?: string

  // 执行结果
  outputDir?: string  // ~/.manta-data/tasks/{id}/
  error?: string

  // 时间戳
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string

  // 对话内聊天产生的隐藏任务，不在任务列表显示
  hidden?: boolean
}

// ─── Agent 来源 ───────────────────────────────────────────────
export type AgentSource =
  | 'plugin-native'   // 从插件目录扫描得到

// ─── Agent 注册表 ───────────────────────────────────────────────
export interface AgentEntry {
  /** Agent 名字，工作流中用 agent: <name> 引用 */
  name: string

  /** 使用的 Runner ID */
  runnerId: string

  /** CLI 可执行文件路径，留空则从 PATH 自动发现 */
  bin?: string

  /** 关联的 Skill ID 列表 */
  skillIds?: string[]

  /** 附加技能/工具名称（向后兼容，deprecated） */
  skills?: string[]

  /** 描述信息 */
  description?: string

  /** 是否启用 */
  enabled: boolean

  /** Agent 来源：plugin-native（插件扫描）或 manta-custom（用户手动创建）*/
  source?: AgentSource

  /** 来自哪个插件（对应 plugin.yaml 的 id）*/
  pluginId?: string

  /** AI: agent 定义文件的绝对路径（用于查看/编辑）*/
  filePath?: string

  /** 定义文件是否只读 */
  fileReadonly?: boolean

  /** AI: SOUL.md 是否可编辑（区分文件只读和系统提示可编辑）*/
  soulEditable?: boolean
}

// ─── 插件系统 ───────────────────────────────────────────────

/** plugin.yaml 的类型定义 */
export interface PluginManifest {
  /** 插件唯一 ID */
  id: string

  /** 插件名称（显示用）*/
  name: string

  /** 对应的 Runner ID */
  runnerId: string

  /** 描述 */
  description?: string

  /** agents 目录扫描路径列表（支持 ~ 展开） */
  agentsDirs?: string[]

  /** agent 格式 */
  agentFormat: string

  // 是否为外部安装的插件（loader 自动填充，plugin.yaml 本身无此字段）
  isNpm?: boolean

  // 是否禁用（loader 从 plugins/_disabled.json 读取，plugin.yaml 本身无此字段）
  disabled?: boolean
}

/** 插件 Adapter 接口 — 每个插件实现此接口 */
export interface PluginAdapter {
  readonly manifest: PluginManifest

  /** 扫描 agents 目录，返回 AgentEntry 列表 */
  loadAgents(): Promise<AgentEntry[]>

  /** 探测插件对应的 Runner 是否可用 */
  probe(): Promise<{ available: boolean; reason?: string; version?: string }>
}

// ─── Agent CRUD 操作接口（插件层实现，Core 只知道此接口）─────────

/** 创建 agent 的参数 */
export interface CreateAgentParams {
  /** agent 唯一名称（英文/连字符/下划线）*/
  name: string
  /** 系统提示内容（SOUL.md 正文）*/
  soul: string
  /** 描述（可选）*/
  description?: string
}

/** 更新 agent 的参数（所有字段可选）*/
export interface UpdateAgentParams {
  /** 更新后的系统提示内容 */
  soul?: string
  /** 更新后的描述 */
  description?: string
}

/**
 * AgentOps — Agent 文件操作接口
 */
export interface AgentOps {
  /** 创建 agent */
  createAgent(params: CreateAgentParams): Promise<void>

  /** 更新 agent 定义（仅更新有传入的字段） */
  updateAgent(name: string, params: UpdateAgentParams): Promise<void>

  /** 读取 agent 的系统提示内容 */
  readAgentContent(name: string): Promise<string | null>

  /** 删除 agent */
  deleteAgent(name: string): Promise<void>

  /** 检查 agent 是否已存在 */
  agentExists(name: string): Promise<boolean>
}

// ─── Runner 接口 ───────────────────────────────────────────────
export interface RunParams {
  /** Agent 条目 */
  agent: AgentEntry

  /** 任务 */
  task: Task

  /** 输出目录 */
  outputDir: string
}

export interface RunResult {
  success: boolean
  exitCode?: number
  outputFiles: string[]
  error?: string
  durationMs: number
}

export interface Runner {
  /** Runner 唯一 ID */
  readonly id: string

  /** 检测此 Runner 在当前环境是否可用 */
  probe(): Promise<{ available: boolean; reason?: string; version?: string }>

  /** 执行 Agent 任务 */
  run(params: RunParams): Promise<RunResult>
}

// ─── Channel 接口 ───────────────────────────────────────────────
export interface ChannelMessage {
  title: string
  body: string
  taskId?: string
  action?: 'approve' | 'reject' | 'view'
}

export interface Channel {
  /** Channel 唯一 ID */
  readonly id: string

  /** 发送通知 */
  send(message: ChannelMessage): Promise<void>
}

// ─── 工作流相关 ───────────────────────────────────────────────
export type WorkflowStepType =
  | 'agent'
  | 'human_in_loop'
  | 'parallel'
  | 'conditional'
  | 'loop'

export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  name: string
  agentName?: string
  next?: string
  actions?: Record<string, string>
  notify?: boolean | { mac?: boolean; webhook?: boolean }
  /** AI: 并行步骤的子分支 */
  branches?: WorkflowStep[]
}

export interface WorkflowDef {
  id: string
  name: string
  description?: string
  version?: string
  steps: WorkflowStep[]
}

// ─── 工作流执行状态 ───────────────────────────────────────────────

/** 单步执行状态 */
export type StepStatus =
  | 'pending'        // 待执行
  | 'running'        // 执行中
  | 'waiting'        // 等待人工操作（human_in_loop）
  | 'done'           // 完成
  | 'failed'         // 失败
  | 'skipped'        // 已跳过

/** 工作流执行实例整体状态 */
export type WorkflowExecutionStatus =
  | 'running'
  | 'waiting'        // 暂停在 human_in_loop 步骤
  | 'done'
  | 'failed'

/** 单步执行日志条目 */
export interface StepLog {
  stepId: string
  stepName: string
  status: StepStatus
  agentName?: string
  startedAt?: string
  completedAt?: string
  error?: string
  /** human_in_loop 步骤的可选操作 */
  actions?: Record<string, string>
}

/** 工作流执行实例（对应一个 Task 的 workflow 执行过程） */
export interface WorkflowExecution {
  /** 对应 Task ID */
  taskId: string
  /** 工作流定义 ID */
  workflowId: string
  /** 当前整体状态 */
  status: WorkflowExecutionStatus
  /** 当前正在执行或等待的 stepId */
  currentStepId?: string
  /** 所有步骤的执行日志 */
  steps: StepLog[]
  /** 工作流上下文（各步骤输出） */
  context: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ─── 数据存储 ───────────────────────────────────────────────
export interface DataStore {
  getTasks(): Promise<Task[]>
  getTask(id: string): Promise<Task | null>
  createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task>
  updateTask(id: string, patch: Partial<Task>): Promise<Task>
  deleteTask(id: string): Promise<void>
}

// ─── 智能体应用 ───────────────────────────────────────────────

/** 应用状态 */
export type AppStatus = 'draft' | 'published' | 'archived'

/** Agent 参数覆盖 */
export interface AgentOverride {
  /** 覆盖 system prompt */
  systemPrompt?: string
  /** 覆盖 temperature */
  temperature?: number
  /** 覆盖 maxTokens */
  maxTokens?: number
  /** 覆盖模型 */
  model?: string
}

/** RAG 知识库绑定 */
export interface RagBinding {
  /** 关联知识库 ID */
  knowledgeBaseId: string
  /** 检索 TopK，默认 5 */
  topK: number
  /** 相似度阈值，默认 0.7 */
  similarityThreshold: number
  /** 混合检索开关 */
  hybridSearchEnabled: boolean
  /** 混合检索向量权重，默认 0.7 */
  vectorWeight: number
}

/** 自动化任务 */
export interface Automation {
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
}

/** 应用配置 */
export interface AppConfig {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  status: AppStatus

  /** Agent 绑定 */
  agentId: string
  agentOverride: AgentOverride
  /** 关联工作流 ID（可选） */
  workflowId?: string

  /** 知识库绑定 */
  ragBinding: RagBinding | null

  /** 启用的工具 */
  enabledTools: string[]

  /** 自动化 */
  automations: Automation[]

  /** 时间戳 */
  createdAt: string
  updatedAt: string
  publishedAt: string | null

  /** 版本号（乐观锁） */
  version: number
}

/** 创建应用的输入 */
export interface CreateAppInput {
  name: string
  description?: string
  icon?: string
  tags?: string[]
}

/** 更新应用的输入 */
export interface UpdateAppInput {
  name?: string
  description?: string
  icon?: string
  tags?: string[]
  status?: AppStatus
  agentId?: string
  agentOverride?: Partial<AgentOverride>
  ragBinding?: RagBinding | null
  enabledTools?: string[]
  automations?: Automation[]
}
// ─── 工作空间配置 ───────────────────────────────────────────────

/** 工作空间配置（顶层运行环境，包含多个会话） */
export interface WorkspaceConfig {
  id: string
  name: string
  description?: string

  /** 绑定的本地文件夹路径 */
  folderPath?: string

  /** 绑定的智能体应用 ID 列表 */
  agentAppIds: string[]

  /** 绑定的知识库 ID 列表 */
  knowledgeBaseIds: string[]

  /** 绑定的工作流 ID 列表 */
  workflowIds: string[]

  createdAt: string
  updatedAt: string
}

/** 创建工作空间的输入 */
export interface CreateWorkspaceInput {
  name: string
  description?: string
  folderPath?: string
}

/** 更新工作空间的输入 */
export interface UpdateWorkspaceInput {
  name?: string
  description?: string
  agentAppIds?: string[]
  knowledgeBaseIds?: string[]
  workflowIds?: string[]
}

// ─── 知识库类型 ───────────────────────────────────────────────

/** 知识库配置 */
export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  /** 使用的 RAG Provider ID */
  providerId: string
  /** 知识库配置 */
  config: {
    dimensions?: number
    similarityThreshold?: number
    topK?: number
    hybridSearch?: {
      enabled: boolean
      vectorWeight: number
      keywordWeight: number
    }
  }
  /** 文档数量 */
  documentCount: number
  /** 块数量 */
  chunkCount: number
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

// ─── 会话类型 ───────────────────────────────────────────────

/** 会话类型 */
export type ConversationType = 'global' | 'workspace'

/** 创建会话的输入 */
export interface CreateConversationInput {
  agentName: string
  title?: string
  type: ConversationType
  workspaceId?: string  // type='workspace' 时必填
}

/** 持久化的工具调用记录（一次工具调用的 input/output） */
export interface ToolCallRecord {
  toolCallId: string
  toolName: string
  input: unknown
  output: unknown
  isError: boolean
  errorText?: string
}

/** 单步 token 用量（含缓存明细） */
export interface StepUsageRecord {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  noCacheTokens?: number
  toolNames?: string[]
}

/** 会话消息 */
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  toolCalls?: ToolCallRecord[]
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    noCacheTokens?: number
  }
  stepUsages?: StepUsageRecord[]
  /** 关联的智能体应用 ID（@调用时使用） */
  agentAppId?: string
}

/** 会话上下文 */
export interface ConversationContext {
  [key: string]: unknown
}

/** 会话 */
export interface Conversation {
  id: string
  title: string
  agentName: string
  messages: ConversationMessage[]
  context: ConversationContext
  workspaceId?: string
  createdAt: string
  updatedAt: string
}

/** 会话摘要（列表展示用） */
export interface ConversationSummary {
  id: string
  title: string
  agentName: string
  createdAt: string
  updatedAt: string
  workspaceId?: string
  messageCount?: number
}

// ─── @调用 ───────────────────────────────────────────────

/** @调用提及信息 */
export interface AtMention {
  agentAppId: string
  agentAppName: string
  startIndex: number
  endIndex: number
}

/*  end: 核心类型定义结束 */
