/* 日志文件写入服务端模块 */

/**
 * 日志文件写入器（仅服务端使用）
 * 该模块使用 Node.js fs 模块，只能在服务端环境中使用
 */
import { currentDiagnosticsOwner, type DiagnosticEntry } from '../../../storage/runtime-diagnostics'

export class LogFileWriter {
  private static instance: LogFileWriter | null = null
  private constructor() {}

  /** 获取单例实例 */
  static getInstance(): LogFileWriter {
    if (!LogFileWriter.instance) {
      LogFileWriter.instance = new LogFileWriter()
    }
    return LogFileWriter.instance
  }

  /** 检查是否可用（是否在服务端环境） */
  isAvailable(): boolean {
    return currentDiagnosticsOwner() !== undefined
  }

  /** 获取系统日志文件路径 */
  getLogFilePath(): string {
    return currentDiagnosticsOwner()?.getLogFilePath() ?? ''
  }

  /** 获取会话专属日志文件路径 */
  getSessionLogFilePath(conversationId: string): string {
    return currentDiagnosticsOwner()?.getSessionLogFilePath(conversationId) ?? ''
  }

  /** 将日志追加写入文件 */
  appendToFile(entry: { id: string; timestamp: string; [key: string]: unknown }): void {
    const owner = currentDiagnosticsOwner()
    if (owner) { owner.append(entry as DiagnosticEntry); return }
  }

  /** Queue normal diagnostic logs so slow storage cannot block Agent TTFT. */
  appendToFileDeferred(entry: { id: string; timestamp: string; [key: string]: unknown }): void {
    const owner = currentDiagnosticsOwner()
    if (owner) { owner.appendDeferred(entry as DiagnosticEntry); return }
  }

}

/** 全局日志文件写入器实例 */
export const logFileWriter = LogFileWriter.getInstance()
