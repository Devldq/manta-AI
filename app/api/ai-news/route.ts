/* AI start: AI要闻 API — GET 列出历史摘要 / POST 拉取并生成今日摘要 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

// AI: 存储目录：~/arm-data/ai-news/
const AI_NEWS_DIR = path.join(
  process.env.ARM_DATA_ROOT
    ? path.resolve(process.env.ARM_DATA_ROOT.replace('~', os.homedir()))
    : path.join(os.homedir(), 'arm-data'),
  'ai-news'
)

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function digestFilePath(date: string): string {
  return path.join(AI_NEWS_DIR, `${date}.md`)
}

// AI: 解析摘要文件，返回结构化数据
export interface DigestMeta {
  date: string
  fetchedAt: string
  itemCount: number
  summary: string
}

function listDigests(): DigestMeta[] {
  ensureDir(AI_NEWS_DIR)
  const files = fs.readdirSync(AI_NEWS_DIR)
    .filter(f => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
    .sort()
    .reverse()

  return files.map(f => {
    const date = f.replace('.md', '')
    const content = fs.readFileSync(path.join(AI_NEWS_DIR, f), 'utf-8')
    const fetchedAt = content.match(/fetchedAt: (.+)/)?.[1]?.trim() ?? date
    const itemCount = (content.match(/^## /gm) ?? []).length
    const summaryMatch = content.match(/<!-- SUMMARY -->\n([\s\S]*?)\n<!-- \/SUMMARY -->/)
    const summary = summaryMatch ? summaryMatch[1].trim() : ''
    return { date, fetchedAt, itemCount, summary }
  })
}

// AI: 从 follow-builders 中央 feed 拉取（若失败，降级到直接抓取真实 AI 新闻源）
async function fetchFollowBuildersFeed(): Promise<{ items: { title: string; summary: string; source: string; url: string }[] } | null> {
  const feedUrl = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed/latest.json'
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.json() as { items: { title: string; summary: string; source: string; url: string }[] }
  } catch {
    return null
  }
}

// AI: 直接抓取 Anthropic Engineering 博客最新文章
async function fetchAnthropicBlog(): Promise<{ title: string; url: string; summary: string }[]> {
  try {
    const res = await fetch('https://www.anthropic.com/engineering', { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const html = await res.text()
    // AI: 提取文章标题和链接（简单 regex）
    const matches = [...html.matchAll(/<a[^>]+href="(\/engineering\/[^"]+)"[^>]*>([^<]{10,120})<\/a>/g)]
    return matches.slice(0, 3).map(m => ({
      title: m[2].trim().replace(/\s+/g, ' '),
      url: `https://www.anthropic.com${m[1]}`,
      summary: '',
    }))
  } catch {
    return []
  }
}

// AI: 抓取 Hacker News AI 分类热门（官方 API）
interface HNItem { id: number; title: string; url?: string; score: number; descendants?: number }
async function fetchHNAI(): Promise<{ title: string; url: string; score: number }[]> {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const ids = (await res.json() as number[]).slice(0, 50)
    const items = await Promise.all(
      ids.slice(0, 20).map(async id => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(5000) })
          return await r.json() as HNItem
        } catch { return null }
      })
    )
    return items
      .filter((item): item is HNItem => {
        if (!item) return false
        const t = (item.title ?? '').toLowerCase()
        return t.includes('ai') || t.includes('llm') || t.includes('gpt') || t.includes('claude') ||
          t.includes('model') || t.includes('agent') || t.includes('anthropic') || t.includes('openai') ||
          t.includes('gemini') || t.includes('neural') || t.includes('machine learning') || t.includes('deep learning')
      })
      .slice(0, 8)
      .map(item => ({
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score,
      }))
  } catch {
    return []
  }
}

// AI: 将英文标题智能翻译为中文摘要句（用于直接展示的中文标题）
function translateToChineseTitle(en: string): string {
  // AI: 词组级替换表（按长词优先替换）
  const PHRASE_MAP: [RegExp, string][] = [
    [/scaling laws?/gi, '扩展定律'],
    [/chain[- ]of[- ]thought/gi, '思维链'],
    [/fine[- ]tuning/gi, '微调'],
    [/open[- ]source/gi, '开源'],
    [/machine learning/gi, '机器学习'],
    [/deep learning/gi, '深度学习'],
    [/context window/gi, '上下文窗口'],
    [/synthetic data/gi, '合成数据'],
    [/\bllms?\b/gi, '大语言模型'],
    [/\bgpt[- ]?\d*/gi, (m) => m],
    [/\bagents?\b/gi, '智能体'],
    [/\bmodels?\b/gi, '模型'],
    [/\binference\b/gi, '推理'],
    [/\btraining\b/gi, '训练'],
    [/\bbenchmark\b/gi, '基准测试'],
    [/\balignment\b/gi, '对齐'],
    [/\breasoning\b/gi, '推理'],
    [/\bmultimodal\b/gi, '多模态'],
    [/\bembedding\b/gi, '向量嵌入'],
    [/\bfrontier\b/gi, '前沿'],
    [/\bsafety\b/gi, '安全性'],
    [/\bhallucination\b/gi, '幻觉'],
    [/\bprompt(ing)?\b/gi, '提示词'],
    [/\bretrieval\b/gi, '检索'],
    [/\bscaling\b/gi, '规模扩展'],
    [/\bresearch\b/gi, '研究'],
    [/\bpaper\b/gi, '论文'],
    [/\breleases?\b/gi, '发布'],
    [/\blaunches?\b/gi, '发布'],
    [/\bannounces?\b/gi, '宣布'],
    [/\bintroduces?\b/gi, '推出'],
    [/\bupdates?\b/gi, '更新'],
    [/\battack\b/gi, '攻击事件'],
    [/\bvulnerabilit(y|ies)\b/gi, '漏洞'],
    [/\bopen[- ]?ai\b/gi, 'OpenAI'],
    [/\banthropic\b/gi, 'Anthropic'],
    [/\bgemini\b/gi, 'Gemini'],
    [/\bclaude\b/gi, 'Claude'],
    [/\bpair programming\b/gi, '结对编程'],
    [/\bmalware\b/gi, '恶意软件'],
    [/\bself[- ]editing\b/gi, '自编辑'],
    [/\bsearch agent\b/gi, '搜索智能体'],
    [/\btransport layer\b/gi, '传输层'],
    [/\bvps\b/gi, 'VPS 服务器'],
  ]

  let cn = en
  for (const [pattern, replacement] of PHRASE_MAP) {
    if (typeof replacement === 'string') {
      cn = cn.replace(pattern, replacement)
    } else {
      cn = cn.replace(pattern, replacement as (m: string) => string)
    }
  }

  // AI: 若替换后仍无中文字符，原样保留英文（不做乱码式翻译）
  const hasChineseChar = /[\u4e00-\u9fff]/.test(cn)
  if (!hasChineseChar) return en
  return cn
}

// AI: 生成今日摘要 Markdown（每条新闻只输出中文标题 + 链接，不保留英文原文）
async function generateDigest(date: string): Promise<string> {
  const [feedData, anthropicPosts, hnItems] = await Promise.all([
    fetchFollowBuildersFeed(),
    fetchAnthropicBlog(),
    fetchHNAI(),
  ])

  const lines: string[] = []
  const now = new Date().toISOString()

  lines.push(`---`)
  lines.push(`date: ${date}`)
  lines.push(`fetchedAt: ${now}`)
  lines.push(`source: follow-builders + anthropic + hackernews`)
  lines.push(`---`)
  lines.push('')
  lines.push(`# AI 要闻日报 · ${date}`)
  lines.push('')

  const cnTitles: string[] = []

  // AI: follow-builders feed 优先
  if (feedData?.items && feedData.items.length > 0) {
    lines.push('## 🎙️ Podcast & Builder 动态')
    lines.push('')
    for (const item of feedData.items) {
      const cnTitle = translateToChineseTitle(`[${item.source}] ${item.title}`)
      lines.push(`> TITLE: ${cnTitle}`)
      if (item.url) lines.push(`> 🔗 ${item.url}`)
      lines.push('')
      cnTitles.push(cnTitle)
    }
  }

  // AI: Anthropic 博客
  if (anthropicPosts.length > 0) {
    lines.push('## 📖 Anthropic 工程博客')
    lines.push('')
    for (const post of anthropicPosts) {
      const cnTitle = translateToChineseTitle(post.title)
      lines.push(`> TITLE: ${cnTitle}`)
      lines.push(`> 🔗 ${post.url}`)
      lines.push('')
      cnTitles.push(cnTitle)
    }
  }

  // AI: Hacker News AI 热帖
  if (hnItems.length > 0) {
    lines.push('## 🔥 Hacker News · AI 热榜')
    lines.push('')
    for (const item of hnItems) {
      const cnTitle = translateToChineseTitle(item.title)
      lines.push(`> TITLE: ${cnTitle} _（${item.score} 分）_`)
      lines.push(`> 🔗 ${item.url}`)
      lines.push('')
      cnTitles.push(cnTitle)
    }
  }

  // AI: 生成 SUMMARY（用前 3 条中文标题）
  const summaryText = cnTitles.slice(0, 3).join(' · ') || '今日暂无新动态'
  const summaryIdx = lines.findIndex(l => l.startsWith('## '))
  if (summaryIdx !== -1) {
    lines.splice(summaryIdx, 0, '<!-- SUMMARY -->', summaryText, '<!-- /SUMMARY -->', '')
  }

  // AI: 若完全没有内容
  if (!lines.some(l => l.startsWith('##'))) {
    lines.push('<!-- SUMMARY -->')
    lines.push('网络暂时不可用，请稍后重试')
    lines.push('<!-- /SUMMARY -->')
    lines.push('')
    lines.push('## ⚠️ 暂无数据')
    lines.push('')
    lines.push('> TITLE: 暂无内容，follow-builders feed 及新闻源暂时无法访问，请稍后重试')
    lines.push('')
  }

  lines.push('---')
  lines.push(`_由 ARM AI要闻 · follow-builders skill · baoyu-translate 驱动_`)

  return lines.join('\n')
}

// AI: GET /api/ai-news — 返回历史摘要列表，若今日无摘要自动触发拉取
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const autoFetch = searchParams.get('autoFetch') === '1'

  ensureDir(AI_NEWS_DIR)
  const today = todayDate()
  const todayFile = digestFilePath(today)

  // AI: 今日首次访问自动拉取
  if (autoFetch && !fs.existsSync(todayFile)) {
    const content = await generateDigest(today)
    fs.writeFileSync(todayFile, content, 'utf-8')
  }

  const digests = listDigests()
  return NextResponse.json({ digests, today })
}

// AI: POST /api/ai-news — 强制重新拉取今日摘要
export async function POST() {
  ensureDir(AI_NEWS_DIR)
  const today = todayDate()
  const content = await generateDigest(today)
  fs.writeFileSync(digestFilePath(today), content, 'utf-8')
  const digests = listDigests()
  return NextResponse.json({ ok: true, date: today, digests })
}
/* AI end: AI要闻 API */
