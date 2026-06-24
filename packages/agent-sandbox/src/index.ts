/**
 * @manta/agent-sandbox - Manta Agent 安全沙箱 SDK
 * 
 * 提供跨平台的工具执行边界控制和审计日志功能
 */

// 导出核心类型
export type {
  SecurityContext,
  ApprovalRequest,
  AuditEntry,
  PathValidationResult,
  CommandValidationResult,
  Platform,
} from './types'

// 导出上下文管理
export {
  securityContextStorage,
  runWithSecurityContext,
  getSecurityContext,
  updateSecurityContext,
  createDefaultSecurityContext,
  detectPlatform,
} from './context/SecurityContext'

// 导出路径验证器
export {
  normalizePath,
  isPathInAllowedRoots,
  validatePathAccess,
  validatePathsAccess,
} from './validators/PathValidator'

// 导出命令验证器
export {
  isDangerousCommand,
  extractPathsFromCommand,
  validateCommand,
} from './validators/CommandValidator'

// 导出平台执行器
export type { PlatformExecutor } from './platform/index'
export { getPlatformExecutor } from './platform/index'

// 导出审计日志器
export {
  log as auditLog,
  readLogs as readAuditLogs,
  clearLogs as clearAuditLogs,
  getLogSize as getAuditLogSize,
  createAuditEntry,
} from './audit/AuditLogger'
