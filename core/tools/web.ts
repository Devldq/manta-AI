/* core/tools/web — 网络工具集
 *
 * 工具列表：
 * - webFetch  — 抓取网页内容
 * - webSearch — 网页搜索（DuckDuckGo）
 */
import type { ToolDefinition } from '@/core/tool-registry'

// ─── 工具定义 ────────────────────────────────────────────────────────────────

/** WebFetch — 抓取网页内容 */
function createWebFetchTool(): ToolDefinition {
  return {
    name: 'webFetch',
    description: '抓取指定 URL 的网页内容，并根据 prompt 提取关键信息。适合查阅文档、获取网页数据。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网页 URL' },
        prompt: { type: 'string', description: '描述需要从页面中提取的信息' },
      },
      required: ['url', 'prompt'],
    },
    isConcurrencySafe: true,
    shouldDefer: true,
    searchHint: 'fetch scrape webpage url content extract html',
    execute: async (input: any) => {
      const { url, prompt: _prompt } = input
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(30000),
        })

        const contentType = res.headers.get('content-type') ?? ''
        const text = await res.text()

        const stripped = contentType.includes('text/html')
          ? text
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s{2,}/g, ' ')
              .trim()
          : text

        return {
          url,
          status: res.status,
          contentType,
          content: stripped.slice(0, 100000),
          truncated: stripped.length > 100000,
        }
      } catch (err) {
        return { error: `抓取失败：${String(err)}`, url }
      }
    },
  }
}

/** WebSearch — 网页搜索（调用 DuckDuckGo 搜索） */
function createWebSearchTool(): ToolDefinition {
  return {
    name: 'webSearch',
    description: '通过 DuckDuckGo 搜索互联网，返回搜索结果列表（标题、URL、摘要）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询词' },
        allowed_domains: {
          type: 'array',
          items: { type: 'string' },
          description: '仅返回这些域名的结果',
        },
        blocked_domains: {
          type: 'array',
          items: { type: 'string' },
          description: '排除这些域名的结果',
        },
      },
      required: ['query'],
    },
    isConcurrencySafe: true,
    shouldDefer: true,
    searchHint: 'web search internet query duckduckgo find online',
    execute: async (input: any) => {
      const { query, allowed_domains, blocked_domains } = input
      try {
        const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' })
        const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
          headers: { 'User-Agent': 'Manta-Agent/1.0' },
          signal: AbortSignal.timeout(15000),
        })
        const data = await res.json() as {
          AbstractText?: string
          AbstractURL?: string
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>
        }

        const results: Array<{ title: string; url: string; snippet: string }> = []

        if (data.AbstractText && data.AbstractURL) {
          results.push({
            title: query,
            url: data.AbstractURL,
            snippet: data.AbstractText,
          })
        }

        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics) {
            if (topic.Text && topic.FirstURL) {
              const url = topic.FirstURL
              const hostname = new URL(url).hostname
              if (allowed_domains && !allowed_domains.some((d: string) => hostname.includes(d))) continue
              if (blocked_domains && blocked_domains.some((d: string) => hostname.includes(d))) continue
              results.push({ title: topic.Text.split(' - ')[0] ?? topic.Text, url, snippet: topic.Text })
            }
            if (results.length >= 10) break
          }
        }

        return { query, count: results.length, results }
      } catch (err) {
        return { error: `搜索失败：${String(err)}`, query }
      }
    },
  }
}

// ─── 工厂函数 ────────────────────────────────────────────────────────────────

/** 创建所有网络工具 */
export function createWebTools(): ToolDefinition[] {
  return [
    createWebFetchTool(),
    createWebSearchTool(),
  ]
}
