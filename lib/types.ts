/* AI start: 全局类型定义 */

export type TaskStatus =
  | 'Inbox'
  | 'InProgress'
  | 'Done'
  | 'Blocked'
  | 'Cancelled'

// AI: 单个工作流步骤的状态
export type WorkflowStepStatus =
  | 'pending'    // 未开始（等待前置步骤完成）
  | 'running'    // 执行中（agent 正在处理 / 等待人工操作）
  | 'done'       // 已完成
  | 'rejected'   // 被退回（human_in_loop 退回）
  | 'skipped'    // 已跳过

// AI: 工作流步骤执行日志 — 记录每个步骤的进度与产出
export interface WorkflowStepLog {
  stepId: string              // 步骤 ID（对应 YAML 中的 step.id）
  stepName: string            // 步骤名称（展示用）
  status: WorkflowStepStatus  // 步骤状态
  agentId?: string            // 执行该步骤的 agent（human_in_loop 为 'you'）
  startedAt?: string          // 开始时间
  completedAt?: string        // 完成时间
  outputNote?: string         // 产出摘要 / agent 回写的备注
  outputs?: Record<string, string>  // 步骤产出文件路径 key→path
  progress?: number           // 可选：进度 0-100
  error?: string              // 若步骤失败或被退回，记录原因
}

export interface Task {
  id: string
  title: string
  description: string
  workflowId?: string            // AI: 工作流可选，不绑定则为普通任务
  workflowStep?: string          // AI: 当前所在工作流步骤 ID（如 architecting/pending_approval/developing）
  stepLogs?: WorkflowStepLog[]   // AI: 每个工作流步骤的执行记录（按步骤顺序）
  status: TaskStatus
  assignedAgent?: string
  requirementDoc?: string        // 需求文档路径
  backendDesign?: string         // 后端技术方案路径
  frontendDesign?: string        // 可选：前端技术方案路径
  devSummary?: string            // 可选：dev 改动摘要路径
  repos?: string[]               // 关联仓库列表
  qaReport?: string              // 可选：QA 报告路径
  reviewReport?: string          // 可选：CR 报告路径
  qaDone?: boolean               // AI: QA 是否完成
  reviewDone?: boolean           // AI: CR 是否完成
  score?: number                 // 最终打分
  createdAt: string
  updatedAt: string
  deletedAt?: string             // AI: 软删除时间戳，有值表示已删除
  history: TaskHistoryEntry[]
  blockedReason?: string
}

export interface TaskHistoryEntry {
  from: TaskStatus
  to: TaskStatus
  agent: string
  note?: string
  timestamp: string
}

export type AgentStatus = 'active' | 'banned' | 'cloned'

export interface AgentStats {
  agentId: string
  displayName: string
  health: number          // 生命值，初始 60，最大 100
  status: AgentStatus
  generation: number      // 代数，1 为初代
  parentId: string | null // 复制自哪个 Agent
  completedTasks: number
  failedTasks: number
  totalTokens: number
  skills: string[]
  createdAt: string
  lastActiveAt: string
}

export interface QueueMessage {
  id: string
  taskId: string
  from: string
  to: string
  type: 'task_assign' | 'task_update' | 'score' | 'system'
  content: string
  timestamp: string
  read: boolean
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'approval' | 'score' | 'warning' | 'info'
  taskId?: string
  agentId?: string
  timestamp: string
  read: boolean
}

export interface WorkflowStep {
  id: string
  agent?: string
  name: string
  type?: 'human_in_loop'
  inputs?: string[]
  outputs?: string[]
  next?: string
  parallel?: boolean
  branches?: Array<{
    agent: string
    name: string
    inputs?: string[]
  }>
  after_all?: string
  actions?: Record<string, string>
  notify?: string
}

export interface WorkflowConfig {
  id: string
  name: string
  description?: string
  steps: WorkflowStep[]
  notifications?: Record<string, { type: string; message: string }>
}

// AI: 通用任务状态标签
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  Inbox: '待处理',
  InProgress: '进行中',
  Done: '已完成',
  Blocked: '阻塞',
  Cancelled: '已取消',
}

// AI: 通用任务状态颜色
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  Inbox: 'bg-gray-600',
  InProgress: 'bg-blue-600',
  Done: 'bg-green-600',
  Blocked: 'bg-red-600',
  Cancelled: 'bg-gray-500',
}

// AI: 定时任务类型
export interface CronTask {
  id: string
  name: string
  description?: string
  cronExpression: string
  command: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastRunStatus?: 'success' | 'failed' | 'running'
  nextRunAt?: string
  runCount: number
  failCount: number
}

// AI: 定时任务执行记录
export interface ExecutionRecord {
  id: string
  taskId: string
  taskName: string
  startedAt: string
  endedAt?: string
  status: 'running' | 'success' | 'failed' | 'cancelled'
  output?: string
  error?: string
  duration?: number
}

/* AI end: 全局类型定义 */
