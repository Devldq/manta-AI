/* AI start: 全局类型定义 */

export type TaskStatus =
  | 'Inbox'
  | 'Architecting'
  | 'PendingApproval'
  | 'Developing'
  | 'ParallelReview'
  | 'PendingScore'
  | 'Done'
  | 'Blocked'
  | 'Cancelled'

export interface Task {
  id: string
  title: string
  description: string
  workflowId: string
  status: TaskStatus
  assignedAgent?: string
  requirementDoc?: string   // 需求文档路径
  backendDesign?: string    // 后端技术方案路径
  frontendDesign?: string   // 架构师产出的前端技术方案
  repos?: string[]          // 关联仓库列表
  qaReport?: string         // QA 报告内容
  reviewReport?: string     // CR 报告内容
  qaDone?: boolean
  reviewDone?: boolean
  score?: number            // 最终打分
  createdAt: string
  updatedAt: string
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

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  Inbox: '待分配',
  Architecting: '架构规划中',
  PendingApproval: '待审批',
  Developing: '开发中',
  ParallelReview: '并行检查',
  PendingScore: '待打分',
  Done: '已完成',
  Blocked: '阻塞',
  Cancelled: '已取消',
}

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  Inbox: 'bg-gray-600',
  Architecting: 'bg-blue-600',
  PendingApproval: 'bg-yellow-600',
  Developing: 'bg-indigo-600',
  ParallelReview: 'bg-purple-600',
  PendingScore: 'bg-orange-600',
  Done: 'bg-green-600',
  Blocked: 'bg-red-600',
  Cancelled: 'bg-gray-500',
}

/* AI end: 全局类型定义 */
