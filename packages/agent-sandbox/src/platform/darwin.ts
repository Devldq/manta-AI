/**
 * macOS 平台特定实现
 * Phase2 将实现 Docker 容器隔离
 */

import type { PlatformExecutor } from './index'
import type { Platform } from '../types'

const executor: PlatformExecutor = {
  platform: 'macos',
  
  async executeInSandbox(command, options) {
    // TODO: Phase2 实现 Docker 容器隔离
    // 当前直接执行命令（无沙箱）
    const { exec } = await import('node:child_process')
    
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      exec(command, {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout,
      }, (error, stdout, stderr) => {
        if (error) {
          // 命令执行失败，但是有输出
          resolve({
            exitCode: error.code || 1,
            stdout: stdout || '',
            stderr: stderr || error.message || '',
          })
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout || '',
            stderr: stderr || '',
          })
        }
      })
    })
  },
  
  async createSandbox(taskId) {
    // TODO: Phase2 实现
    console.log(`[macOS] 创建沙箱: ${taskId}`)
  },
  
  async destroySandbox(taskId) {
    // TODO: Phase2 实现
    console.log(`[macOS] 销毁沙箱: ${taskId}`)
  },
}

export default executor
