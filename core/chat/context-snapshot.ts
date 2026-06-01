/**
 * Context Snapshot — 记录每步 agent loop 传给 LLM 的完整消息快照
 *
 * 设计目的：
 * - 让 Context Tab 面板能看到每一步实际传给大模型的上下文内容
 * - 用于评估 Microcompact 和 Compaction 的压缩效果
 * - 诊断"模型看不到什么信息"的问题
 *
 * 存储格式：NDJSON（每行一条 JSON），写入会话专属文件
 * 路径：~/.manta-data/conversations/<id>/context-snapshots.ndjson
 *
 * 注意：此文件可能较大（完整消息内容），每次新 loop 启动时截断重写
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ModelMessage } from 'ai'
import { estimateTokensFromChars, getMessageCharCount } from './token-estimator'

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 单步上下文快照 */
export interface ContextStepSnapshot {
  /** 步骤索引（从 0 开始） */
  stepIndex: number
  /** 时间戳 */
  timestamp: number
  /** 消息总数 */
  messageCount: number
  /** 估算 token 数 */
  estimatedTokens: number
  /** 完整消息列表（序列化后的 JSON） */
  messages: SerializableMessage[]
  /** 消息角色分布统计 */
  roleDistribution: Record<string, number>
}

/** 可序列化的消息（去除不可 JSON 化的字段） */
interface SerializableMessage {
  role: string
  /** 内容摘要：text 消息显示内容，tool-call 显示工具名+参数，tool-result 显示工具名+结果摘要 */
  content: string
  /** 原始内容的字符数 */
  charCount: number
  /** 估算 token 数 */
  estimatedTokens: number
  /** 工具名（如果是 tool 消息） */
  toolName?: string
  /** 是否已被 Microcompact 清理 */
  cleared: boolean
  /** 是否被 Layer 2 动态截断（Head/Tail 分割） */
  truncated: boolean
  /** 是否被 Layer 2 总量预算清理（compacted） */
  compacted: boolean
  /** 是否被 Layer 3 TTL 软修剪（soft pruned） */
  ttlSoftPruned: boolean
  /** 是否被 Layer 3 TTL 硬清除（hard pruned / expired） */
  ttlHardPruned: boolean
}

// ─── 配置常量 ────────────────────────────────────────────────────────────────

/** 快照文件目录基础路径 */
const DATA_DIR = path.join(os.homedir(), '.manta-data', 'conversations')

/** 每条消息内容的最大字符数（防止快照文件过大） */
const MAX_MESSAGE_CONTENT_LENGTH = 2000

/** 快照文件最大行数（FIFO，超过则丢弃最早的） */
const MAX_SNAPSHOT_LINES = 100

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

const CLEARED_PLACEHOLDER = '[tool result cleared]'

/** 截断标记前缀（Layer 2 Pass 1：Head/Tail 分割后的 truncation notice） */
const TRUNCATED_PREFIX = '[truncated:'

/** compacted 标记前缀（Layer 2 Pass 2：总量预算清理） */
const COMPACTED_PREFIX = '[compacted:'

/** TTL 软修剪标记（Layer 3：时间衰减 — 软修剪） */
const TTL_SOFT_PRUNED_MARKER = '[soft pruned:'

/** TTL 硬清除标记前缀（Layer 3：时间衰减 — 硬清除 / 过期） */
const TTL_HARD_PRUNED_PREFIX = '[tool result expired'

// estimateTokensFromChars 和 getMessageCharCount 统一使用 token-estimator.ts

/** 检查消息是否被 Microcompact 清理 */
function isMessageCleared(msg: ModelMessage): boolean {
  if (!Array.isArray(msg.content)) return false
  for (const part of msg.content) {
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool-result') {
      const output = (part as Record<string, unknown>).output as Record<string, unknown> | undefined
      if (output?.type === 'text' && output.value === CLEARED_PLACEHOLDER) {
        return true
      }
    }
  }
  return false
}

/** 检查消息是否被 Layer 2 动态截断（Pass 1：Head/Tail 分割） */
function isMessageTruncated(msg: ModelMessage): boolean {
  if (!Array.isArray(msg.content)) return false
  for (const part of msg.content) {
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool-result') {
      const output = (part as Record<string, unknown>).output as Record<string, unknown> | undefined
      const value = output?.value as string | undefined
      if (value?.startsWith?.(TRUNCATED_PREFIX)) {
        // truncated 标记在内容中间，检查内容是否包含截断标记
        return true
      }
      // 更准确的检测：检查 output value 中是否包含 [truncated: ...] 标记
      if (typeof value === 'string' && value.includes('[truncated:')) {
        return true
      }
    }
  }
  return false
}

/** 检查消息是否被 Layer 2 总量预算清理（Pass 2：compacted） */
function isMessageCompacted(msg: ModelMessage): boolean {
  if (!Array.isArray(msg.content)) return false
  for (const part of msg.content) {
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool-result') {
      const output = (part as Record<string, unknown>).output as Record<string, unknown> | undefined
      const value = output?.value as string | undefined
      if (typeof value === 'string' && value.startsWith(COMPACTED_PREFIX)) {
        return true
      }
    }
  }
  return false
}

/** 检查消息是否被 Layer 3 TTL 软修剪（soft pruned） */
function isMessageTTLSoftPruned(msg: ModelMessage): boolean {
  if (!Array.isArray(msg.content)) return false
  for (const part of msg.content) {
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool-result') {
      const output = (part as Record<string, unknown>).output as Record<string, unknown> | undefined
      const value = output?.value as string | undefined
      if (typeof value === 'string' && value.includes(TTL_SOFT_PRUNED_MARKER)) {
        return true
      }
    }
  }
  return false
}

/** 检查消息是否被 Layer 3 TTL 硬清除（hard pruned / expired） */
function isMessageTTLHardPruned(msg: ModelMessage): boolean {
  if (!Array.isArray(msg.content)) return false
  for (const part of msg.content) {
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'tool-result') {
      const output = (part as Record<string, unknown>).output as Record<string, unknown> | undefined
      const value = output?.value as string | undefined
      if (typeof value === 'string' && value.startsWith(TTL_HARD_PRUNED_PREFIX)) {
        return true
      }
    }
  }
  return false
}

/** 提取消息的工具名 */
function getMessageToolName(msg: ModelMessage): string | undefined {
  if (!Array.isArray(msg.content)) return undefined
  for (const part of msg.content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if ((p.type === 'tool-result' || p.type === 'tool-call') && typeof p.toolName === 'string') {
      return p.toolName
    }
  }
  return undefined
}

/** 将消息内容转为可读的字符串表示 */
function formatMessageContent(msg: ModelMessage): string {
  const content = msg.content

  if (typeof content === 'string') {
    return content.length > MAX_MESSAGE_CONTENT_LENGTH
      ? content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + `\n... [截断，原文 ${content.length} 字符]`
      : content
  }

  if (!Array.isArray(content)) {
    const str = JSON.stringify(content)
    return str.length > MAX_MESSAGE_CONTENT_LENGTH
      ? str.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + `\n... [截断]`
      : str
  }

  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') {
      parts.push(String(part))
      continue
    }
    const p = part as Record<string, unknown>
    switch (p.type) {
      case 'text':
        if (typeof p.text === 'string') {
          const text = p.text
          parts.push(text.length > MAX_MESSAGE_CONTENT_LENGTH
            ? text.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + `... [截断，原文 ${text.length} 字符]`
            : text)
        }
        break
      case 'tool-call':
        parts.push(`[调用工具: ${p.toolName}] 参数: ${JSON.stringify(p.input)}`)
        break
      case 'tool-result': {
        const output = p.output as Record<string, unknown> | undefined
        if (output?.type === 'text' && output.value === CLEARED_PLACEHOLDER) {
          parts.push(`[工具结果: ${p.toolName}] [已被 Microcompact 清理]`)
        } else if (output?.type === 'error-text') {
          parts.push(`[工具结果: ${p.toolName}] 错误: ${String(output.value ?? '').slice(0, 500)}`)
        } else {
          const outputStr = JSON.stringify(p.output)
          // 检测是否被 Layer 2 截断或 compacted，添加标记
          let extraTag = ''
          if (output?.type === 'text') {
            const val = output.value as string | undefined
            if (typeof val === 'string' && val.startsWith(COMPACTED_PREFIX)) {
              extraTag = ' [已被动态截断清理]'
            } else if (typeof val === 'string' && val.startsWith(TTL_HARD_PRUNED_PREFIX)) {
              extraTag = ' [TTL 已过期]'
            } else if (typeof val === 'string' && val.includes('[soft pruned:')) {
              extraTag = ' [TTL 软修剪]'
            } else if (typeof val === 'string' && val.includes('[truncated:')) {
              extraTag = ' [已截断]'
            }
          }
          parts.push(`[工具结果: ${p.toolName}]${extraTag} ${outputStr.length > 800 ? outputStr.slice(0, 800) + '...' : outputStr}`)
        }
        break
      }
      default:
        parts.push(JSON.stringify(p).slice(0, 200))
    }
  }
  return parts.join('\n')
}

// getMessageCharCount 统一使用 token-estimator.ts 中的导出

// ─── 核心函数 ────────────────────────────────────────────────────────────────

/**
 * 获取会话的快照文件路径
 */
export function getSnapshotPath(conversationId: string): string {
  return path.join(DATA_DIR, conversationId, 'context-snapshots.ndjson')
}

/**
 * 清空会话的快照文件（在新 loop 启动时调用）
 */
export function clearSnapshots(conversationId: string): void {
  const dir = path.join(DATA_DIR, conversationId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const filePath = getSnapshotPath(conversationId)
  fs.writeFileSync(filePath, '', 'utf-8')
}

/**
 * 记录一步的上下文快照到 NDJSON 文件
 *
 * @param conversationId - 会话 ID
 * @param stepIndex - 步骤索引
 * @param messages - 当前消息列表（传给 LLM 的完整上下文）
 */
export function recordContextSnapshot(
  conversationId: string,
  stepIndex: number,
  messages: ModelMessage[],
): void {
  const dir = path.join(DATA_DIR, conversationId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // 构建可序列化消息列表
  const serializable: SerializableMessage[] = messages.map(msg => {
    const charCount = getMessageCharCount(msg)
    return {
      role: msg.role,
      content: formatMessageContent(msg),
      charCount,
      estimatedTokens: estimateTokensFromChars(charCount),
      toolName: getMessageToolName(msg),
      cleared: isMessageCleared(msg),
      truncated: isMessageTruncated(msg),
      compacted: isMessageCompacted(msg),
      ttlSoftPruned: isMessageTTLSoftPruned(msg),
      ttlHardPruned: isMessageTTLHardPruned(msg),
    }
  })

  // 角色分布统计
  const roleDistribution: Record<string, number> = {}
  for (const m of serializable) {
    roleDistribution[m.role] = (roleDistribution[m.role] || 0) + 1
  }

  const totalTokens = serializable.reduce((s, m) => s + m.estimatedTokens, 0)

  const snapshot: ContextStepSnapshot = {
    stepIndex,
    timestamp: Date.now(),
    messageCount: messages.length,
    estimatedTokens: totalTokens,
    messages: serializable,
    roleDistribution,
  }

  const filePath = getSnapshotPath(conversationId)

  // FIFO：如果行数超限，截断最早的行
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
      if (existing.length >= MAX_SNAPSHOT_LINES) {
        // 保留最近 N-1 行 + 新行
        const trimmed = existing.slice(-(MAX_SNAPSHOT_LINES - 1))
        fs.writeFileSync(filePath, trimmed.join('\n') + '\n' + JSON.stringify(snapshot) + '\n', 'utf-8')
        return
      }
    }
  } catch {
    // 忽略读取错误，直接追加
  }

  // 追加新行
  fs.appendFileSync(filePath, JSON.stringify(snapshot) + '\n', 'utf-8')
}

/**
 * 读取会话的所有上下文快照
 */
export function loadContextSnapshots(conversationId: string): ContextStepSnapshot[] {
  const filePath = getSnapshotPath(conversationId)
  if (!fs.existsSync(filePath)) return []

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return content
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as ContextStepSnapshot
        } catch {
          return null
        }
      })
      .filter((s): s is ContextStepSnapshot => s !== null)
  } catch {
    return []
  }
}
