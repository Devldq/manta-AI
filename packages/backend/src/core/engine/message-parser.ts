/* AI start: 解析 UI 消息格式 */
import type { ModelMessage } from 'ai'

/** UI Message 部分类型 */
export interface UIMessagePart {
  type: string
  text?: string
}

/** UI Message 类型（来自前端） */
export interface UIMessage {
  role: string
  parts?: UIMessagePart[]
  content?: string
}

/** 从 UI Message parts 中提取纯文本 */
export function extractText(parts: UIMessagePart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
}

/** 将 UIMessage[] 转换为 ModelMessage[] 供 streamText 使用
 * 只取最近 20 条，避免过长上下文污染模型判断 */
export function parseMessagesToCore(messages: UIMessage[]): ModelMessage[] {
  const filtered = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.parts
        ? extractText(m.parts as UIMessagePart[])
        : (m.content ?? ''),
    }))
    .filter((m) => m.content)

  // 保留最近 20 条，确保第一条是 user 消息
  const recent = filtered.slice(-20)
  const firstUserIdx = recent.findIndex((m) => m.role === 'user')
  return firstUserIdx > 0 ? recent.slice(firstUserIdx) : recent
}
/* AI end: 消息解析逻辑结束 */
