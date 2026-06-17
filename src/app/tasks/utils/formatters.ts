import type { UIMessage, TextUIPart } from 'ai'
import type { ToolCallEntry } from './types'

/** 格式化 token 数：≥10000 显示为 x.xw */
export function fmtTokens(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w'
  return String(n)
}

/** 格式化时间戳为 HH:mm */
export function formatTime(ts: string | undefined): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return ''
  }
}

/** 获取消息文本内容 */
export function getTextContent(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is TextUIPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** 提取工具调用 */
export function extractToolCalls(parts: UIMessage['parts']): ToolCallEntry[] {
  if (!parts) return []
  const entries: ToolCallEntry[] = []
  for (const p of parts) {
    if (typeof p.type !== 'string') continue
    const isStaticTool = p.type.startsWith('tool-') && p.type !== 'tool-invocation'
    const isDynamic = p.type === 'dynamic-tool'
    if (!isStaticTool && !isDynamic) continue

    const cast = p as {
      type: string
      toolName?: string
      toolCallId: string
      state: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
    const toolName = isDynamic ? (cast.toolName ?? 'unknown') : p.type.replace(/^tool-/, '')
    entries.push({
      toolCallId: cast.toolCallId,
      toolName,
      state: cast.state,
      input: cast.input,
      output: cast.output,
      errorText: cast.errorText,
    })
  }
  return entries
}

/** 格式化工具输入/输出为可读字符串，截断过长内容 */
export function formatValue(v: unknown, maxLen = 400): string {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > maxLen ? s.slice(0, maxLen) + '\n…（已截断）' : s
}

/** 把工具调用转成一句人读的动作描述 */
export function describeToolCall(entry: ToolCallEntry): string {
  const input = entry.input as Record<string, unknown> | null | undefined
  switch (entry.toolName) {
    case 'bash': {
      const cmd = String(input?.command ?? '')
      const desc = input?.description ? ` (${input.description})` : ''
      const displayCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd
      return `执行命令: ${displayCmd}${desc}`
    }
    case 'lsDir': {
      const p = String(input?.dir_path ?? '')
      return `列出目录 ${p}`
    }
    case 'readFile': {
      const p = String(input?.file_path ?? '')
      return `读取文件 ${p}`
    }
    case 'glob': {
      const pat = String(input?.pattern ?? '')
      const root = input?.path ? ` (${input.path})` : ''
      return `匹配文件 ${pat}${root}`
    }
    case 'grep': {
      const pat = String(input?.pattern ?? '')
      const sp = input?.search_path ? ` 在 ${input.search_path}` : ''
      return `搜索 "${pat}"${sp}`
    }
    default:
      return entry.toolName
  }
}
