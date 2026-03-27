/* AI start: AI要闻文章下载与翻译 API — 使用 openclaw CLI agent 做翻译 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// AI: openclaw CLI 路径（优先 PATH，fallback ~/.openclaw/bin/openclaw）
const OPENCLAW_BIN = process.env.OPENCLAW_BIN
  ?? path.join(os.homedir(), '.openclaw', 'bin', 'openclaw')

// AI: 存储目录：~/arm-data/ai-news/articles/{date}/{slug}.json
const AI_NEWS_DIR = path.join(
  process.env.ARM_DATA_ROOT
    ? path.resolve(process.env.ARM_DATA_ROOT.replace('~', os.homedir()))
    : path.join(os.homedir(), 'arm-data'),
  'ai-news'
)

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// AI: 文章缓存结构
export interface ArticleCache {
  url: string
  slug: string
  date: string
  title: string           // AI: 英文原标题
  titleCN: string         // AI: 中文标题
  paragraphs: { en: string; cn: string }[]  // AI: 中英文对照段落
  originalText: string    // AI: 英文原文
  fetchedAt: string
  translatedAt: string
  wordCount: number
  status: 'ok' | 'failed' | 'partial'
  error?: string
}

// AI: URL → 安全文件名（slug）
export function urlToSlug(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, 100)
}

// AI: 构建文章缓存路径
function articleCachePath(date: string, slug: string): string {
  const dir = path.join(AI_NEWS_DIR, 'articles', date)
  ensureDir(dir)
  return path.join(dir, `${slug}.json`)
}

// AI: 读取文章缓存
function readArticleCache(date: string, slug: string): ArticleCache | null {
  const p = articleCachePath(date, slug)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as ArticleCache
  } catch {
    return null
  }
}

// AI: 写入文章缓存
function writeArticleCache(cache: ArticleCache) {
  const p = articleCachePath(cache.date, cache.slug)
  fs.writeFileSync(p, JSON.stringify(cache, null, 2), 'utf-8')
}

// AI: 从 HTML 中提取文章正文（按段落分割）
function extractParagraphs(html: string): string[] {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')

  // AI: 优先提取 <article> / <main>
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  const mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
  const source = articleMatch?.[1] ?? mainMatch?.[1] ?? text

  // AI: 提取段落内容
  const paras: string[] = []
  // AI: 先尝试逐 <p> 提取
  const pMatches = [...source.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
  if (pMatches.length >= 3) {
    for (const m of pMatches) {
      const clean = m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim()
      if (clean.length > 20) paras.push(clean)
    }
    return paras.slice(0, 40) // AI: 最多 40 段
  }

  // AI: 降级：按换行分段
  const plain = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return plain.split('\n\n').filter(p => p.trim().length > 20).slice(0, 40)
}

// AI: 过滤 openclaw 日志行，提取真实的 agent 输出内容
function extractAgentReply(stdout: string): string {
  const LOG_PATTERNS = [
    /^🦞/,
    /^\d{2}:\d{2}:\d{2}\s+\[/,   // AI: 时间戳日志 06:47:30 [...]
    /^\[security\/model-guard\]/,
    /^\[/,                          // AI: 任意方括号开头的日志行
  ]
  const lines = stdout.split('\n')
  const replyLines = lines.filter(line => {
    const trimmed = line.trim()
    if (!trimmed) return false
    return !LOG_PATTERNS.some(p => p.test(trimmed))
  })
  return replyLines.join('\n').trim()
}

// AI: 单段翻译：调用 openclaw CLI agent，过滤日志行后返回中文
async function translateOne(en: string): Promise<string> {
  const message = `请将以下英文技术内容翻译成中文，只输出翻译结果，不要任何解释或前缀：\n\n${en}`
  try {
    const { stdout } = await execFileAsync(
      OPENCLAW_BIN,
      ['agent', '--agent', 'taizi', '--local', '--message', message],
      {
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 5,
        env: { ...process.env, PATH: `${path.dirname(OPENCLAW_BIN)}:${process.env.PATH}` },
      }
    )
    const reply = extractAgentReply(stdout)
    return reply.length > 0 ? reply : en
  } catch {
    return en
  }
}

// AI: 逐段翻译所有段落（串行调用，每次一段，保证翻译准确）
async function translateParagraphs(
  enParagraphs: string[]
): Promise<{ en: string; cn: string }[]> {
  // AI: 最多翻译前 15 段（控制总耗时在合理范围内）
  const MAX_PARAS = 15
  const toTranslate = enParagraphs.slice(0, MAX_PARAS)
  const result: { en: string; cn: string }[] = []

  for (const en of toTranslate) {
    const cn = await translateOne(en)
    result.push({ en, cn })
  }

  // AI: 超出部分保留英文原文（不翻译）
  for (let i = MAX_PARAS; i < enParagraphs.length; i++) {
    result.push({ en: enParagraphs[i], cn: enParagraphs[i] })
  }

  return result
}

// AI: 翻译文章标题
async function translateTitle(title: string): Promise<string> {
  const cn = await translateParagraphWithAgent(title)
  return cn.length > 0 ? cn : title
}

// AI: GET /api/ai-news/articles?url=...&date=... — 读取文章缓存
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url')
  const date = searchParams.get('date')

  if (!url || !date) {
    return NextResponse.json({ error: 'url and date are required' }, { status: 400 })
  }

  const slug = urlToSlug(url)
  const cache = readArticleCache(date, slug)
  if (!cache) {
    return NextResponse.json({ error: 'not cached' }, { status: 404 })
  }

  return NextResponse.json(cache)
}

// AI: POST /api/ai-news/articles — 下载并翻译文章（使用 openclaw agent CLI）
export async function POST(req: NextRequest) {
  const body = await req.json() as { url: string; title: string; date: string }
  const { url, title, date } = body

  if (!url || !date) {
    return NextResponse.json({ error: 'url and date are required' }, { status: 400 })
  }

  const slug = urlToSlug(url)

  // AI: 命中缓存直接返回
  const existing = readArticleCache(date, slug)
  if (existing && existing.status === 'ok') {
    return NextResponse.json(existing)
  }

  const fetchedAt = new Date().toISOString()
  let enParagraphs: string[] = []
  let wordCount = 0

  // AI: Step 1 — 下载原文 HTML，提取段落
  try {
    const htmlRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ARM-AINews/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20000),
    })
    if (htmlRes.ok) {
      const html = await htmlRes.text()
      enParagraphs = extractParagraphs(html)
      wordCount = enParagraphs.join(' ').split(/\s+/).filter(Boolean).length
    }
  } catch {
    enParagraphs = [title]
  }

  if (enParagraphs.length === 0) enParagraphs = [title]

  // AI: Step 2 — 翻译标题和段落（openclaw agent CLI）
  let titleCN = title
  let paragraphs: { en: string; cn: string }[] = []
  let status: ArticleCache['status'] = 'ok'
  let error: string | undefined

  try {
    const [cnTitle, cnParagraphs] = await Promise.all([
      translateTitle(title),
      translateParagraphs(enParagraphs),
    ])
    titleCN = cnTitle
    paragraphs = cnParagraphs
  } catch (e) {
    status = 'failed'
    error = (e as Error).message
    paragraphs = enParagraphs.map(en => ({ en, cn: en }))
  }

  const cache: ArticleCache = {
    url,
    slug,
    date,
    title,
    titleCN,
    paragraphs,
    originalText: enParagraphs.join('\n\n').slice(0, 20000),
    fetchedAt,
    translatedAt: new Date().toISOString(),
    wordCount,
    status,
    ...(error ? { error } : {}),
  }

  writeArticleCache(cache)
  return NextResponse.json(cache)
}
/* AI end: AI要闻文章下载与翻译 API */
