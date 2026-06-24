/**
 * 平台检测和执行层 - 导出平台特定实现
 */

import type { Platform } from '../types'

export { detectPlatform } from '../context/SecurityContext'
export type { Platform }

// 平台特定实现将在 Phase2 中实现
// 当前仅导出类型和方法签名

export interface PlatformExecutor {
  /** 平台名称 */
  platform: Platform
  
  /**
   * 在沙箱中执行命令
   * @param command 命令字符串
   * @param options 执行选项
   */
  executeInSandbox(
    command: string,
    options: {
      cwd: string
      env?: Record<string, string>
      timeout?: number
    }
  ): Promise<{
    exitCode: number
    stdout: string
    stderr: string
  }>
  
  /**
   * 创建沙箱环境
   * @param taskId 任务 ID
   */
  createSandbox(taskId: string): Promise<void>
  
  /**
   * 销毁沙箱环境
   * @param taskId 任务 ID
   */
  destroySandbox(taskId: string): Promise<void>
}

/**
 * 根据平台获取执行器
 * @param platform 平台类型
 * @returns 平台执行器
 */
export async function getPlatformExecutor(platform: Platform): Promise<PlatformExecutor> {
  switch (platform) {
    case 'macos':
      return (await import('./darwin.js')).default
    case 'linux':
      return (await import('./linux.js')).default
    case 'windows':
      return (await import('./windows.js')).default
    default:
      throw new Error(`不支持的平台: ${platform}`)
  }
}
