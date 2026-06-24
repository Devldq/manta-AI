/**
 * 共享安全上下文存储
 * 
 * 解决 tsx 无法正确解析 @manta/agent-sandbox 导出的问题
 * 所有工具和 agent-loop 都使用同一个 AsyncLocalStorage 实例
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface SecurityContext {
  taskId?: string
  workspaceId?: string
  allowedRoots: string[]
  shellAllowedRoots: string[]
  networkAccess?: boolean
  maxFileSize?: number
  platform: string
  allowExternalRead?: boolean
  allowExternalWrite?: boolean
  onApprovalRequest?: unknown
  onAuditLog?: unknown
}

/** 全局唯一的安全上下文存储 */
export const securityContextStorage = new AsyncLocalStorage<SecurityContext>()

/** 获取当前安全上下文 */
export function getSecurityContext(): SecurityContext | undefined {
  return securityContextStorage.getStore()
}

/** 在安全上下文中执行函数 */
export function runWithSecurityContext<T>(ctx: SecurityContext, fn: () => T): T {
  return securityContextStorage.run(ctx, fn)
}

/** 创建默认安全上下文 */
export function createDefaultSecurityContext(taskId: string): SecurityContext {
  const cwd = process.cwd()
  return {
    allowedRoots: [cwd],
    allowExternalRead: true,
    allowExternalWrite: false,
    shellAllowedRoots: [cwd],
    taskId,
    platform: detectPlatform(),
    onApprovalRequest: undefined,
    onAuditLog: undefined,
  }
}

function detectPlatform(): 'macos' | 'linux' | 'windows' {
  const platform = process.platform
  switch (platform) {
    case 'darwin': return 'macos'
    case 'linux': return 'linux'
    case 'win32': return 'windows'
    default: return 'linux'
  }
}
