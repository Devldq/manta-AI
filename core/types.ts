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

  // 执行结果
  outputDir?: string  // ~/arm-data/tasks/{id}/
  error?: string

  // 时间戳
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

// ─── Agent 来源 ───────────────────────────────────────────────
export type AgentSource =
  | 'plugin-native'   // 从插件目录扫描得到（openclaw/claude-code 原生 agents）
  | 'manta-custom'    // 用户在 Manta 界面手动创建

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

  /** agents 目录扫描路径列表（支持 ~ 展开）*/
  agentsDirs: string[]

  /** Agent 文件格式
   * - markdown: YAML frontmatter + MD body（claude-code sub-agents，每个文件是一个 agent）
   * - yaml: YAML 配置文件（openclaw agents 目录，每个 yaml 是一个 agent）
   * - codeflicker-skill: CodeFlicker Skills（每个 skill 是一个子目录，内含 SKILL.md）
   */
  agentFormat: 'markdown' | 'yaml' | 'codeflicker-skill'
}

/** 插件 Adapter 接口 — 每个插件实现此接口 */
export interface PluginAdapter {
  readonly manifest: PluginManifest

  /** 扫描 agents 目录，返回 AgentEntry 列表 */
  loadAgents(): Promise<AgentEntry[]>

  /** 探测插件对应的 Runner 是否可用 */
  probe(): Promise<{ available: boolean; reason?: string; version?: string }>
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
}

export interface WorkflowDef {
  id: string
  name: string
  description?: string
  version?: string
  steps: WorkflowStep[]
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
