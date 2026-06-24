/**
 * 安全上下文管理 - 使用 AsyncLocalStorage 实现任务级隔离
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { SecurityContext, Platform } from '../types'

/**
 * 安全上下文存储 - 使用 Node.js AsyncLocalStorage 实现异步上下文隔离
 * 确保并发任务之间的安全上下文互不影响
 */
export const securityContextStorage = new AsyncLocalStorage<SecurityContext>()

/**
 * 在安全上下文中执行函数
 * @param ctx 安全上下文
 * @param fn 要执行的函数
 * @returns 函数执行结果
 */
export function runWithSecurityContext<T>(ctx: SecurityContext, fn: () => T): T {
  return securityContextStorage.run(ctx, fn)
}

/**
 * 获取当前安全上下文
 * @returns 当前安全上下文，如果不存在则返回 undefined
 */
export function getSecurityContext(): SecurityContext | undefined {
  return securityContextStorage.getStore()
}

/**
 * 更新当前安全上下文
 * @param patch 要更新的字段
 */
export function updateSecurityContext(patch: Partial<SecurityContext>): void {
  const current = getSecurityContext()
  if (current) {
    Object.assign(current, patch)
  }
}

/**
 * 创建默认安全上下文
 * @param taskId 任务 ID
 * @param platform 平台类型
 * @returns 默认安全上下文
 */
export function createDefaultSecurityContext(
  taskId: string,
  platform: Platform = detectPlatform()
): SecurityContext {
  const cwd = process.cwd()
  
  return {
    allowedRoots: [cwd],
    allowExternalRead: true,
    allowExternalWrite: false,
    shellAllowedRoots: [cwd],
    taskId,
    platform,
    onApprovalRequest: undefined,
    onAuditLog: undefined,
  }
}

/**
 * 检测当前平台
 * @returns 平台类型
 */
export function detectPlatform(): Platform {
  const platform = process.platform
  
  switch (platform) {
    case 'darwin':
      return 'macos'
    case 'linux':
      return 'linux'
    case 'win32':
      return 'windows'
    default:
      return 'linux' // 默认返回 linux
  }
}
