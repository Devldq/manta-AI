/**
 * 共享安全上下文存储
 * 
 * 解决 tsx 无法正确解析 @manta/agent-sandbox 导出的问题
 * 所有工具和 agent-loop 都使用同一个 AsyncLocalStorage 实例
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { ApprovalMode } from './security/approval-policy.js'

export interface SecurityContext {
  taskId?: string
  workspaceId?: string
  allowedRoots: string[]
  shellAllowedRoots: string[]
  networkAccess?: boolean
  abortSignal?: AbortSignal
  jobId?: string
  attempt?: number
  registerProcess?: (pid: number, label: string) => void
  unregisterProcess?: (pid: number) => void
  maxFileSize?: number
  platform: string
  allowExternalRead?: boolean
  allowExternalWrite?: boolean
  approvalMode?: ApprovalMode
  onApprovalRequest?: (request: SecurityApprovalRequest) => Promise<boolean>
}

export interface SecurityApprovalRequest {
  type: 'read' | 'write' | 'shell'
  path?: string
  command?: string
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
export function createDefaultSecurityContext(taskId: string, approvalMode: ApprovalMode = 'request'): SecurityContext {
  const cwd = process.cwd()
  return {
    allowedRoots: [cwd],
    allowExternalRead: true,
    allowExternalWrite: true,
    shellAllowedRoots: [cwd],
    approvalMode,
    taskId,
    platform: detectPlatform(),
    onApprovalRequest: undefined,
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
