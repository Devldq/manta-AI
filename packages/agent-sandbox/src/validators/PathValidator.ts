/**
 * 路径验证器 - 检查文件路径是否在允许的根路径内
 */

import * as path from 'path'
import type { PathValidationResult, SecurityContext } from '../types'
import { getSecurityContext } from '../context/SecurityContext'

/**
 * 标准化路径（解析为绝对路径，规范化分隔符）
 */
export function normalizePath(inputPath: string): string {
  return path.resolve(inputPath)
}

/**
 * 检查路径是否在允许的根路径内
 * @param targetPath 目标路径
 * @param allowedRoots 允许的根路径列表
 * @returns 是否在允许范围内
 */
export function isPathInAllowedRoots(
  targetPath: string,
  allowedRoots: string[]
): boolean {
  const normalizedTarget = normalizePath(targetPath)
  
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizePath(root)
    
    // 检查目标路径是否以允许的根路径开头
    // 使用 path.resolve 确保跨平台兼容性
    const relative = path.relative(normalizedRoot, normalizedTarget)
    return !relative.startsWith('..') && !path.isAbsolute(relative)
  })
}

/**
 * 验证路径访问权限
 * @param targetPath 目标路径
 * @param accessType 访问类型（read/write）
 * @param context 安全上下文（可选，默认从 AsyncLocalStorage 获取）
 * @returns 验证结果
 */
export function validatePathAccess(
  targetPath: string,
  accessType: 'read' | 'write'
): PathValidationResult {
  // 获取当前安全上下文
  const context = getSecurityContext()
  
  if (!context) {
    return {
      allowed: false,
      needApproval: false,
      reason: '安全上下文未初始化',
    }
  }
  
  // 检查路径是否在允许的根路径内
  const isInAllowedRoots = isPathInAllowedRoots(targetPath, context.allowedRoots)
  
  if (isInAllowedRoots) {
    // 在允许范围内，直接批准
    return {
      allowed: true,
      needApproval: false,
    }
  }
  
  // 不在允许范围内，需要检查外部访问策略
  if (accessType === 'read' && context.allowExternalRead) {
    // 外部读需要授权
    return {
      allowed: false,
      needApproval: true,
      reason: `路径 ${targetPath} 不在允许的根路径内，需要授权才能读取`,
    }
  }
  
  if (accessType === 'write' && context.allowExternalWrite) {
    // 外部写需要授权
    return {
      allowed: false,
      needApproval: true,
      reason: `路径 ${targetPath} 不在允许的根路径内，需要授权才能写入`,
    }
  }
  
  // 不允许外部访问
  return {
    allowed: false,
    needApproval: false,
    reason: `路径 ${targetPath} 不在允许的根路径内，且不允许外部${accessType === 'read' ? '读取' : '写入'}`,
  }
}

/**
 * 验证多个路径的访问权限
 * @param targetPaths 目标路径列表
 * @param accessType 访问类型
 * @returns 验证结果（如果任一路径不允许，则返回第一个不允许的结果）
 */
export function validatePathsAccess(
  targetPaths: string[],
  accessType: 'read' | 'write'
): PathValidationResult {
  for (const targetPath of targetPaths) {
    const result = validatePathAccess(targetPath, accessType)
    if (!result.allowed) {
      return result
    }
  }
  
  return {
    allowed: true,
    needApproval: false,
  }
}
