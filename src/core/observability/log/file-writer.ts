/* 日志文件写入服务端模块 */

/**
 * 日志文件写入器（仅服务端使用）
 * 该模块使用 Node.js fs 模块，只能在服务端环境中使用
 */
export class LogFileWriter {
  private static instance: LogFileWriter | null = null
  private fs: typeof import('fs') | null = null
  private path: typeof import('path') | null = null
  private os: typeof import('os') | null = null

  private constructor() {
    // 动态导入 Node.js 模块，避免客户端打包
    if (typeof window === 'undefined') {
      try {
        this.fs = require('fs')
        this.path = require('path')
        this.os = require('os')
      } catch {
        // 忽略错误，文件写入功能将不可用
      }
    }
  }

  /** 获取单例实例 */
  static getInstance(): LogFileWriter {
    if (!LogFileWriter.instance) {
      LogFileWriter.instance = new LogFileWriter()
    }
    return LogFileWriter.instance
  }

  /** 检查是否可用（是否在服务端环境） */
  isAvailable(): boolean {
    return this.fs !== null && this.path !== null && this.os !== null
  }

  /** 获取系统日志文件路径 */
  getLogFilePath(): string {
    if (!this.isAvailable()) return ''
    try {
      return this.path!.join(this.os!.homedir(), '.manta-data', 'system.log')
    } catch {
      return ''
    }
  }

  /** 获取会话专属日志文件路径 */
  getSessionLogFilePath(conversationId: string): string {
    if (!this.isAvailable()) return ''
    try {
      const dir = this.path!.join(this.os!.homedir(), '.manta-data', 'conversations', conversationId)
      return this.path!.join(dir, 'log.ndjson')
    } catch {
      return ''
    }
  }

  /** 将日志追加写入文件 */
  appendToFile(entry: { id: string; timestamp: string; [key: string]: unknown }): void {
    if (!this.isAvailable()) return

    try {
      // 1. 写入全局日志文件
      const globalLog = this.getLogFilePath()
      if (globalLog) {
        const globalDir = this.path!.dirname(globalLog)
        if (!this.fs!.existsSync(globalDir)) {
          this.fs!.mkdirSync(globalDir, { recursive: true })
        }
        this.fs!.appendFileSync(globalLog, JSON.stringify(entry) + '\n')
      }

      // 2. 如果有关联的会话ID，同时写入会话专属日志文件
      const metadata = entry.metadata as Record<string, unknown> | undefined
      const conversationId = metadata?.conversationId
      if (conversationId) {
        const sessionLog = this.getSessionLogFilePath(conversationId as string)
        if (sessionLog) {
          const sessionDir = this.path!.dirname(sessionLog)
          if (!this.fs!.existsSync(sessionDir)) {
            this.fs!.mkdirSync(sessionDir, { recursive: true })
          }
          this.fs!.appendFileSync(sessionLog, JSON.stringify(entry) + '\n')
        }
      }
    } catch {
      // 写入失败不影响内存日志
    }
  }
}

/** 全局日志文件写入器实例 */
export const logFileWriter = LogFileWriter.getInstance()
