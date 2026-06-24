/**
 * 命令验证器 - 检查 Shell 命令是否在允许的路径内执行
 */

import * as path from 'path'
import type { CommandValidationResult, SecurityContext } from '../types'
import { getSecurityContext } from '../context/SecurityContext'
import { normalizePath, isPathInAllowedRoots } from './PathValidator'

/**
 * 危险命令模式列表
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /mkfs\./,                  // mkfs 命令
  /dd\s+if=/,                // dd 命令
  />\s*\/dev\/\w+/,          // 重定向到设备
  /chmod\s+777/,             // chmod 777
  /curl\s+.*\|.*sh/,         // curl ... | sh
  /wget\s+.*\|.*sh/,         // wget ... | sh
]

/**
 * 检查命令是否包含危险操作
 * @param command 命令字符串
 * @returns 是否危险
 */
export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))
}

/**
 * 从命令中提取文件路径
 * 这是一个简单的初步解析，后续可以优化为使用 AST 解析
 * @param command 命令字符串
 * @returns 提取的文件路径列表
 */
export function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = []
  
  // 匹配绝对路径（以 / 或 ~ 或 C:\ 开头）
  const absolutePathPattern = /(?:^|\s)(?:~|\/|(?:[A-Za-z]:\\))(?:[^\s<>|&;()[\]{}]+)/g
  let match: RegExpExecArray | null
  
  while ((match = absolutePathPattern.exec(command)) !== null) {
    const extractedPath = match[1] || match[0]
    if (extractedPath) {
      paths.push(extractedPath.trim())
    }
  }
  
  return paths
}

/**
 * 验证 Shell 命令执行权限
 * @param command 命令字符串
 * @param cwd 当前工作目录
 * @returns 验证结果
 */
export function validateCommand(
  command: string,
  cwd: string
): CommandValidationResult {
  // 获取当前安全上下文
  const context = getSecurityContext()
  
  if (!context) {
    return {
      allowed: false,
      needApproval: false,
      reason: '安全上下文未初始化',
      resolvedPaths: [],
    }
  }
  
  // 检查 cwd 是否在允许的 Shell 执行路径内
  const isCwdAllowed = isPathInAllowedRoots(cwd, context.shellAllowedRoots)
  
  if (!isCwdAllowed) {
    return {
      allowed: false,
      needApproval: false,
      reason: `执行路径 ${cwd} 不在允许的 Shell 执行路径内`,
      resolvedPaths: [],
    }
  }
  
  // 提取命令中的文件路径
  const resolvedPaths = extractPathsFromCommand(command)
  
  // 检查提取出的路径是否在允许范围内
  for (const resolvedPath of resolvedPaths) {
    const isPathAllowed = isPathInAllowedRoots(resolvedPath, context.allowedRoots)
    
    if (!isPathAllowed) {
      return {
        allowed: false,
        needApproval: true,
        reason: `命令中包含不允许访问的路径: ${resolvedPath}`,
        resolvedPaths,
      }
    }
  }
  
  // 检查危险命令
  if (isDangerousCommand(command)) {
    return {
      allowed: false,
      needApproval: true,
      reason: '命令包含危险操作，需要授权',
      resolvedPaths,
    }
  }
  
  // 通过所有检查
  return {
    allowed: true,
    needApproval: false,
    resolvedPaths,
  }
}
