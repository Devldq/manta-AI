import type { AtMention } from '@core/types'

/**
 * 解析消息中的 @应用名 提及
 * @param content 消息内容
 * @param apps 已知应用列表，用于匹配应用名和ID
 * @returns AtMention 数组
 */
export function parseAtMentions(
  content: string,
  apps: Array<{ id: string; name: string }>
): AtMention[] {
  const mentions: AtMention[] = []
  // 匹配 @应用名，支持中文、英文、数字、下划线、连字符
  const regex = /@([\w\u4e00-\u9fa5-]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const appName = match[1]
    const startIndex = match.index
    const endIndex = startIndex + match[0].length

    // 查找匹配的应用
    const app = apps.find((a) => a.name === appName)
    if (app) {
      mentions.push({
        agentAppId: app.id,
        agentAppName: app.name,
        startIndex,
        endIndex,
      })
    }
  }

  return mentions
}

/**
 * 从消息内容中提取所有 @提及的应用名
 * @param content 消息内容
 * @returns 应用名数组
 */
export function extractAtMentionNames(content: string): string[] {
  const regex = /@([\w\u4e00-\u9fa5-]+)/g
  const names: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    names.push(match[1])
  }

  return [...new Set(names)] // 去重
}

/**
 * 检查消息是否包含 @提及
 * @param content 消息内容
 * @returns 是否包含 @提及
 */
export function hasAtMentions(content: string): boolean {
  return /@([\w\u4e00-\u9fa5-]+)/.test(content)
}

/**
 * 替换消息中的 @应用名 为可点击的链接或标记
 * @param content 原始消息内容
 * @param mentions 解析出的提及列表
 * @param replaceFn 替换函数
 * @returns 替换后的消息内容
 */
export function replaceAtMentions(
  content: string,
  mentions: AtMention[],
  replaceFn: (mention: AtMention) => string
): string {
  // 从后往前替换，避免索引偏移
  const sortedMentions = [...mentions].sort((a, b) => b.startIndex - a.startIndex)
  let result = content

  for (const mention of sortedMentions) {
    const before = result.slice(0, mention.startIndex)
    const after = result.slice(mention.endIndex)
    result = before + replaceFn(mention) + after
  }

  return result
}