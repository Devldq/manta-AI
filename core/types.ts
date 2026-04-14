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
  outputDir?: string  // ~/arm-data/tasks/{id}/
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
  | 'plugin-native'   // AI: 从插件目录扫描得到（openclaw/claude-code 原生 agents）

// ─── Agent 注册表 ───────────────────────────────────────────────
export interface AgentEntry {
  /** Agent 名字，工作流中用 agent: <name> 引用 */
  name: string

  /** 使用的 Runner ID（网关/驱动层 ID，如 openclaw / claude-code / generic-cli）*/
  runnerId: string

  /** CLI 可执行文件路径，留空则从 PATH 自动发现 */
  bin?: string

  /** 附加技能/工具 */
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

  /** AI: 定义文件是否只读（如 openclaw models.json 含 API key，只展示不允许编辑）*/
  fileReadonly?: boolean

  /** AI: SOUL.md 是否可编辑（区分文件只读和系统提示可编辑）*/
  soulEditable?: boolean
}

// ─── 插件系统 ───────────────────────────────────────────────

/** plugin.yaml 的类型定义 */
export interface PluginManifest {
  /** 插件唯一 ID，如 openclaw / claude-code */
  id: string

  /** 插件名称（显示用）*/
  name: string

  /** 对应的 Runner ID */
  runnerId: string

  /** 描述 */
  description?: string

  /** agents 目录扫描路径列表（支持 ~ 展开）。openclaw-json 格式不需要此字段 */
  agentsDirs?: string[]

  /** agent 格式：
   * - openclaw-json: 读 openclawConfigFile 指向的 JSON 文件（openclaw 格式）
   */
  agentFormat: 'openclaw-json'

  // AI: 是否为 npm 安装的插件（loader 自动填充，plugin.yaml 本身无此字段）
  isNpm?: boolean

  // AI: 是否禁用（loader 从 plugins/_disabled.json 读取，plugin.yaml 本身无此字段）
  disabled?: boolean

  // AI: openclaw-json 格式专用：openclaw 主配置文件路径（支持 ~ 展开）
  openclawConfigFile?: string
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
 * AgentOps — openclaw 插件实现此接口，封装 CLI 特有的 agent 文件操作
 */
export interface AgentOps {
  /**
   * 在 openclaw 中创建 agent
   * - 更新 openclaw.json + 创建 workspace-<name>/SOUL.md
   */
  createAgent(params: CreateAgentParams): Promise<void>

  /**
   * 更新 agent 定义（仅更新有传入的字段）
   */
  updateAgent(name: string, params: UpdateAgentParams): Promise<void>

  /**
   * 读取 agent 的系统提示内容
   * 返回 null 表示 agent 不存在或无法读取
   */
  readAgentContent(name: string): Promise<string | null>

  /**
   * 删除 agent（从 CLI 原生目录中移除）
   */
  deleteAgent(name: string): Promise<void>

  /**
   * 检查 agent 是否已存在于 CLI 中
   */
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
/*  end: 核心类型定义结束 */
