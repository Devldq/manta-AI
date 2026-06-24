/**
 * Manta Agent 安全沙箱 SDK - 核心类型定义
 */

/** 平台类型 */
export type Platform = 'macos' | 'linux' | 'windows'

/** 安全上下文 - 任务级隔离 */
export interface SecurityContext {
  /** 允许操作的根路径白名单 */
  allowedRoots: string[]
  
  /** 外部读默认 true，需授权 */
  allowExternalRead: boolean
  
  /** 外部写默认 false */
  allowExternalWrite: boolean
  
  /** Shell 执行 cwd 允许路径 */
  shellAllowedRoots: string[]
  
  /** 任务 ID */
  taskId: string
  
  /** 工作空间 ID（可选） */
  workspaceId?: string
  
  /** 当前平台 */
  platform: Platform
  
  /** 授权回调 - 触发运行时授权弹窗 */
  onApprovalRequest?: (req: ApprovalRequest) => Promise<boolean>
  
  /** 审计日志回调 */
  onAuditLog?: (entry: AuditEntry) => void
}

/** 授权请求 */
export interface ApprovalRequest {
  /** 请求 ID */
  id: string
  
  /** 请求类型 */
  type: 'read' | 'write' | 'shell'
  
  /** 请求的路径（可选） */
  path?: string
  
  /** 请求的命令（可选） */
  command?: string
  
  /** 请求来源（taskId 或 workspaceId） */
  requestedBy: string
  
  /** 请求时间戳 */
  timestamp: number
}

/** 审计日志条目 */
export interface AuditEntry {
  /** 时间戳 */
  timestamp: string
  
  /** 任务 ID */
  taskId: string
  
  /** 工作空间 ID（可选） */
  workspaceId?: string
  
  /** 操作动作 */
  action: string
  
  /** 操作的路径（可选） */
  path?: string
  
  /** 执行的命令（可选） */
  command?: string
  
  /** 是否批准 */
  approved: boolean
  
  /** 操作耗时（毫秒） */
  durationMs: number
}

/** 路径验证结果 */
export interface PathValidationResult {
  /** 是否允许访问 */
  allowed: boolean
  
  /** 是否需要授权 */
  needApproval: boolean
  
  /** 拒绝原因（如果拒绝） */
  reason?: string
}

/** 命令验证结果 */
export interface CommandValidationResult {
  /** 是否允许执行 */
  allowed: boolean
  
  /** 是否需要授权 */
  needApproval: boolean
  
  /** 拒绝原因（如果拒绝） */
  reason?: string
  
  /** 解析出的文件路径列表 */
  resolvedPaths: string[]
}
