import type { UIMessage, TextUIPart } from 'ai'
import type { ToolCallEntry, StepGroup } from './types'

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

/**
 * 从 message parts 中按 step 边界提取分组
 * 利用 AI SDK 的 step-start / step-end 事件将工具调用组织为步骤
 */
export function extractStepGroups(parts: UIMessage['parts']): StepGroup[] {
  if (!parts || parts.length === 0) return []

  const groups: StepGroup[] = []
  let currentGroup: StepGroup | null = null

  for (const p of parts) {
    // 使用类型断言检查自定义 part 类型（step-start/step-end 可能不在官方类型中）
    const partType = (p as Record<string, unknown>).type as string

    // step-start: 新步骤开始
    if (partType === 'step-start') {
      if (currentGroup && currentGroup.toolCalls.length > 0) {
        // 前一个步骤未完成（无 step-end），标记为完成
        currentGroup.isComplete = true
        currentGroup.isActive = false
      }
      currentGroup = {
        stepIndex: groups.length,
        purposeText: '',
        toolCalls: [],
        isComplete: false,
        isActive: true,
      }
      groups.push(currentGroup)
      continue
    }

    // text part: 收集完整思考文本，同时截取前 100 字符作为摘要
    if (partType === 'text' && currentGroup) {
      const text = (p as TextUIPart).text ?? ''
      currentGroup.thinking = (currentGroup.thinking ?? '') + text
      if (currentGroup.purposeText.length < 100) {
        currentGroup.purposeText += text
      }
      continue
    }

    // 工具调用 part
    if (partType === 'dynamic-tool' || (typeof partType === 'string' && partType.startsWith('tool-') && partType !== 'tool-invocation')) {
      const cast = p as {
        type: string
        toolName?: string
        toolCallId: string
        state: string
        input?: unknown
        output?: unknown
        errorText?: string
      }
      const toolName = partType.startsWith('tool-')
        ? partType.replace(/^tool-/, '')
        : (cast.toolName ?? 'unknown')

      const entry: ToolCallEntry = {
        toolCallId: cast.toolCallId,
        toolName,
        state: cast.state,
        input: cast.input,
        output: cast.output,
        errorText: cast.errorText,
      }

      if (currentGroup) {
        currentGroup.toolCalls.push(entry)
      } else {
        // 没有 step-start 的情况：创建默认组
        const newGroup: StepGroup = {
          stepIndex: groups.length,
          purposeText: '',
          toolCalls: [entry],
          isComplete: false,
          isActive: true,
        }
        groups.push(newGroup)
        currentGroup = newGroup
      }
      continue
    }

    // step-end / finish: 步骤完成
    if (partType === 'step-end' || partType === 'finish') {
      if (currentGroup) {
        currentGroup.isComplete = true
        currentGroup.isActive = false
      }
      continue
    }
  }

  // 最后一个未完成的步骤
  if (currentGroup && !currentGroup.isComplete) {
    // 检查是否所有工具调用都已完成
    const allDone = currentGroup.toolCalls.every(
      (t) => t.state === 'output-available' || t.state === 'output-error'
    )
    if (allDone) {
      currentGroup.isComplete = true
      currentGroup.isActive = false
    }
  }

  // 如果没有 step-start 标记，将所有工具调用归为一组
  if (groups.length === 0) {
    const allTools = extractToolCalls(parts)
    if (allTools.length > 0) {
      groups.push({
        stepIndex: 0,
        purposeText: '',
        toolCalls: allTools,
        isComplete: allTools.every(
          (t) => t.state === 'output-available' || t.state === 'output-error'
        ),
        isActive: !allTools.every(
          (t) => t.state === 'output-available' || t.state === 'output-error'
        ),
      })
    }
  }

  return groups
}

/** 提取工具调用（扁平列表，兼容旧代码） */
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
  return s.length > maxLen ? s.slice(0, maxLen) + '\n…（已截断，共 ' + s.length + ' 字符）' : s
}

/** 格式化工具完整输入为可读字符串（用于展开详情） */
export function formatToolInput(entry: ToolCallEntry): string {
  if (entry.input === undefined || entry.input === null) return '（无输入）'
  return formatValue(entry.input, 2000)
}

/** 格式化工具输出为可读字符串（用于展开详情） */
export function formatToolOutput(entry: ToolCallEntry): string {
  if (entry.state === 'output-error') {
    return `❌ 错误: ${entry.errorText ?? '未知错误'}`
  }
  if (entry.output === undefined || entry.output === null) return '（无输出）'
  return formatValue(entry.output, 2000)
}

/** 把工具调用转成一句人读的动作描述（增强版） */
export function describeToolCall(entry: ToolCallEntry): string {
  const input = entry.input as Record<string, unknown> | null | undefined
  switch (entry.toolName) {
    case 'bash': {
      const cmd = String(input?.command ?? '')
      const desc = input?.description ? `（${input.description}）` : ''
      const displayCmd = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
      return `${desc ? desc + ' ' : ''}${displayCmd}`
    }
    case 'lsDir': {
      const p = String(input?.dir_path ?? '')
      return `查看目录 ${p}`
    }
    case 'readFile': {
      const p = String(input?.file_path ?? '')
      return `读取 ${p}`
    }
    case 'glob': {
      const pat = String(input?.pattern ?? '')
      const root = input?.path ? ` 在 ${input.path}` : ''
      return `搜索文件 ${pat}${root}`
    }
    case 'grep': {
      const pat = String(input?.pattern ?? '')
      const sp = input?.search_path ? ` 在 ${input.search_path}` : ''
      return `搜索内容 "${pat}"${sp}`
    }
    case 'write': {
      const p = String(input?.file_path ?? '')
      return `写入文件 ${p}`
    }
    case 'edit':
    case 'multiEdit': {
      const p = String(input?.file_path ?? '')
      return `编辑 ${p}`
    }
    default:
      return entry.toolName
  }
}

/** 根据工具调用推断步骤目的（当没有 purposeText 时使用） */
export function inferStepPurpose(toolCalls: ToolCallEntry[]): string {
  if (toolCalls.length === 0) return '执行操作'
  const firstTool = toolCalls[0]
  const desc = describeToolCall(firstTool)
  if (toolCalls.length === 1) return desc
  return `${desc} 等 ${toolCalls.length} 个操作`
}

/** 计算步骤组的摘要文本 */
export function getStepSummary(group: StepGroup): string {
  const doneCount = group.toolCalls.filter(
    (t) => t.state === 'output-available' || t.state === 'output-error'
  ).length
  const errorCount = group.toolCalls.filter((t) => t.state === 'output-error').length
  const total = group.toolCalls.length

  if (group.isActive && doneCount < total) {
    return `⏳ ${doneCount}/${total} 完成${errorCount > 0 ? ` · ${errorCount} 个错误` : ''}`
  }
  if (errorCount > 0) {
    return `✅ ${total} 个调用 · ${errorCount} 个错误`
  }
  return `✅ ${total} 个调用`
}
