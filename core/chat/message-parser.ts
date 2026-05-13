/* AI start: 解析 UI 消息格式 */
import type { CoreMessage } from 'ai'

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

/** 将 UIMessage[] 转换为 CoreMessage[] 供 streamText 使用 */
export function parseMessagesToCore(messages: UIMessage[]): CoreMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.parts
        ? extractText(m.parts as UIMessagePart[])
        : (m.content ?? ''),
    }))
    .filter((m) => m.content)
}
/* AI end: 消息解析逻辑结束 */
