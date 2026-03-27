/* AI start: AI要闻页面 — 点击文章触发下载翻译动画，完成后打开新标签中英文对照 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  RefreshCw, ChevronLeft, ChevronRight, Newspaper, ExternalLink,
  Clock, FileText, Loader2, CheckCircle2, AlertTriangle
} from 'lucide-react'

// AI: 摘要元数据类型
interface DigestMeta {
  date: string
  fetchedAt: string
  itemCount: number
  summary: string
}

// AI: 新闻条目
interface NewsItem {
  title: string
  url: string
}
interface NewsGroup {
  heading: string
  items: NewsItem[]
}

// AI: 每篇文章的翻译状态
type TranslateStatus = 'idle' | 'loading' | 'done' | 'error'

// AI: 解析 Markdown 为分组列表
function parseDigestContent(md: string): NewsGroup[] {
  const lines = md.split('\n')
  const groups: NewsGroup[] = []
  let inFrontmatter = false
  let frontmatterDone = false
  let currentGroup: NewsGroup | null = null
  let pendingTitle = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0 && line === '---') { inFrontmatter = true; continue }
    if (inFrontmatter) {
      if (line === '---') { inFrontmatter = false; frontmatterDone = true }
      continue
    }
    if (!frontmatterDone) continue
    if (line.startsWith('<!--')) continue
    if (line.startsWith('## ')) {
      currentGroup = { heading: line.slice(3), items: [] }
      groups.push(currentGroup)
      pendingTitle = ''
    } else if (line.startsWith('> TITLE:')) {
      pendingTitle = line.slice(8).trim()
    } else if (line.startsWith('> 🔗')) {
      const url = line.slice(4).trim()
      if (pendingTitle && currentGroup) {
        currentGroup.items.push({ title: pendingTitle, url })
        pendingTitle = ''
      }
    }
  }
  return groups
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${y}年${m}月${day}日`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  return `${Math.floor(hrs / 24)} 天前`
}

// AI: URL → slug（与 API 保持一致）
function urlToSlug(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 100)
}

// AI: 单条新闻卡片组件 — 含翻译状态动画
function NewsCard({
  item,
  date,
}: {
  item: NewsItem
  date: string
}) {
  const [status, setStatus] = useState<TranslateStatus>('idle')

  // AI: 组件挂载时检查是否已有缓存
  useEffect(() => {
    const slug = urlToSlug(item.url)
    fetch(`/api/ai-news/articles/${slug}?date=${date}`)
      .then(r => { if (r.ok) setStatus('done') })
      .catch(() => {})
  }, [item.url, date])

  const handleClick = async () => {
    if (status === 'loading') return

    // AI: 已翻译 → 直接打开新标签
    if (status === 'done') {
      const slug = urlToSlug(item.url)
      window.open(`/ai-news/article/${slug}?date=${date}`, '_blank')
      return
    }

    // AI: 未翻译 → 触发下载翻译
    setStatus('loading')
    try {
      const res = await fetch('/api/ai-news/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, title: item.title, date }),
      })
      if (res.ok) {
        setStatus('done')
        // AI: 翻译完成后自动打开新标签查看
        const slug = urlToSlug(item.url)
        window.open(`/ai-news/article/${slug}?date=${date}`, '_blank')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  // AI: 图标 & 提示
  const iconEl = () => {
    if (status === 'loading') return (
      <Loader2 size={13} style={{ color: '#4299e1', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
    )
    if (status === 'done') return (
      <CheckCircle2 size={13} style={{ color: '#68d391', flexShrink: 0 }} />
    )
    if (status === 'error') return (
      <AlertTriangle size={13} style={{ color: '#fc8181', flexShrink: 0 }} />
    )
    return (
      <FileText size={13} style={{ color: '#4a5568', flexShrink: 0 }} />
    )
  }

  const hint = status === 'idle' ? '点击下载翻译'
    : status === 'loading' ? '正在下载翻译中…'
    : status === 'done' ? '点击打开中英对照'
    : '翻译失败，点击重试'

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading'}
      title={hint}
      className="w-full flex items-start gap-3 px-4 py-3 rounded-xl text-left transition-all"
      style={{
        background: status === 'done' ? '#172213' : status === 'loading' ? '#131a2a' : '#1e2130',
        border: `1px solid ${
          status === 'done' ? '#276749' :
          status === 'loading' ? '#2b4a7a' :
          status === 'error' ? '#7a2020' :
          '#2d3148'
        }`,
        cursor: status === 'loading' ? 'wait' : 'pointer',
        opacity: status === 'loading' ? 0.85 : 1,
      }}
      onMouseEnter={e => {
        if (status !== 'loading') (e.currentTarget as HTMLElement).style.filter = 'brightness(1.12)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.filter = 'none'
      }}
    >
      {/* AI: 状态图标 */}
      <div className="mt-0.5 flex-shrink-0">
        {iconEl()}
      </div>
      {/* AI: 文章标题 */}
      <span
        className="text-sm leading-relaxed flex-1 min-w-0"
        style={{ color: status === 'done' ? '#c0e8c8' : '#c0cfe0' }}
      >
        {item.title}
      </span>
      {/* AI: 翻译状态提示文字 */}
      <span
        className="flex-shrink-0 text-xs self-center ml-1 whitespace-nowrap"
        style={{ color: status === 'loading' ? '#4299e1' : '#4a5568' }}
      >
        {status === 'loading' ? '翻译中…' : status === 'done' ? '已翻译' : ''}
      </span>
      {/* AI: 外链按钮（单独点击不触发翻译） */}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="flex-shrink-0 self-center p-1 rounded"
        style={{ color: '#4a5568' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#63b3ed' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4a5568' }}
      >
        <ExternalLink size={12} />
      </a>
    </button>
  )
}

export default function AINewsPage() {
  const [digests, setDigests] = useState<DigestMeta[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [today, setToday] = useState('')

  const loadDigests = useCallback(async (auto = false) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/ai-news${auto ? '?autoFetch=1' : ''}`)
      const data = await res.json() as { digests: DigestMeta[]; today: string }
      setDigests(data.digests)
      setToday(data.today)
      if (!selectedDate && data.digests.length > 0) {
        setSelectedDate(data.digests[0].date)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadDigests(true) }, []) // eslint-disable-line

  const loadContent = useCallback(async (date: string) => {
    setContentLoading(true)
    setContent('')
    try {
      const res = await fetch(`/api/ai-news/${date}`)
      if (res.ok) {
        const data = await res.json() as { date: string; content: string }
        setContent(data.content)
      }
    } finally {
      setContentLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedDate) loadContent(selectedDate)
  }, [selectedDate, loadContent])

  const handleFetchToday = async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/ai-news', { method: 'POST' })
      const data = await res.json() as { ok: boolean; digests: DigestMeta[]; date: string }
      setDigests(data.digests)
      setSelectedDate(data.date)
    } finally {
      setFetching(false)
    }
  }

  const newsGroups = content ? parseDigestContent(content) : []
  const selectedMeta = digests.find(d => d.date === selectedDate)
  const currentIdx = digests.findIndex(d => d.date === selectedDate)
  const hasPrev = currentIdx < digests.length - 1
  const hasNext = currentIdx > 0

  return (
    <div className="flex flex-col h-screen" style={{ background: '#0f1117', color: '#e2e8f0' }}>
      {/* AI: 顶部标题栏 */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ borderColor: '#2d3148', background: '#1a1d27' }}
      >
        <div className="flex items-center gap-3">
          <Newspaper size={20} style={{ color: '#63b3ed' }} />
          <div>
            <h1 className="text-base font-bold text-white">AI 要闻</h1>
            <p className="text-xs" style={{ color: '#8892a4' }}>
              follow-builders · Anthropic · Hacker News · 点击文章可下载全文翻译
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedMeta && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: '#1e2130', color: '#8892a4' }}>
              <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
              {relativeTime(selectedMeta.fetchedAt)} 拉取
            </span>
          )}
          <button
            onClick={handleFetchToday}
            disabled={fetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: '#1e3a5f', border: '1px solid #2b6cb0', color: '#63b3ed' }}
          >
            <RefreshCw size={12} style={{ animation: fetching ? 'spin 1s linear infinite' : 'none' }} />
            {fetching ? '拉取中…' : '重新拉取今日'}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* AI: 左侧历史列表 */}
        <aside
          className="w-48 flex-shrink-0 border-r overflow-y-auto"
          style={{ borderColor: '#2d3148', background: '#1a1d27' }}
        >
          <div className="px-3 py-3">
            <p className="text-xs font-medium mb-2 px-1" style={{ color: '#8892a4' }}>历史档案</p>
            {loading ? (
              <div className="text-center py-8 text-xs" style={{ color: '#4a5568' }}>加载中…</div>
            ) : digests.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: '#4a5568' }}>暂无记录</div>
            ) : (
              <div className="space-y-1">
                {digests.map(d => (
                  <button
                    key={d.date}
                    onClick={() => setSelectedDate(d.date)}
                    className="w-full text-left px-3 py-2.5 rounded-lg"
                    style={{
                      background: selectedDate === d.date ? '#1e3a5f' : 'transparent',
                      border: `1px solid ${selectedDate === d.date ? '#2b6cb0' : 'transparent'}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium" style={{ color: selectedDate === d.date ? '#63b3ed' : '#a0aec0' }}>
                        {d.date === today ? '📅 今天' : d.date}
                      </span>
                      {d.itemCount > 0 && (
                        <span className="text-xs rounded-full px-1.5" style={{ background: '#1e2130', color: '#4a5568' }}>
                          {d.itemCount}
                        </span>
                      )}
                    </div>
                    {d.summary && (
                      <p className="text-xs leading-snug line-clamp-2" style={{ color: '#4a5568' }}>
                        {d.summary}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* AI: 新闻列表主区 */}
        <main className="flex-1 overflow-y-auto">
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center h-full" style={{ color: '#4a5568' }}>
              <Newspaper size={40} className="mb-3" />
              <p className="text-sm">选择一个日期查看摘要</p>
            </div>
          ) : contentLoading ? (
            <div className="flex flex-col items-center justify-center h-full" style={{ color: '#4a5568' }}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} className="mb-3" />
              <p className="text-sm">加载中…</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto px-6 py-5">
              {/* AI: 日期导航 */}
              <div className="flex items-center justify-between mb-5">
                <button
                  onClick={() => hasPrev && setSelectedDate(digests[currentIdx + 1].date)}
                  disabled={!hasPrev}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
                  style={{ color: hasPrev ? '#a0aec0' : '#2d3148', background: hasPrev ? '#1e2130' : 'transparent', border: `1px solid ${hasPrev ? '#2d3148' : 'transparent'}` }}
                >
                  <ChevronLeft size={14} /> 前一天
                </button>
                <span className="text-sm font-semibold" style={{ color: '#e2e8f0' }}>
                  {formatDate(selectedDate)}
                </span>
                <button
                  onClick={() => hasNext && setSelectedDate(digests[currentIdx - 1].date)}
                  disabled={!hasNext}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
                  style={{ color: hasNext ? '#a0aec0' : '#2d3148', background: hasNext ? '#1e2130' : 'transparent', border: `1px solid ${hasNext ? '#2d3148' : 'transparent'}` }}
                >
                  后一天 <ChevronRight size={14} />
                </button>
              </div>

              {/* AI: 使用说明 */}
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-5 text-xs"
                style={{ background: '#1a1d27', border: '1px solid #2d3148', color: '#8892a4' }}
              >
                <FileText size={11} style={{ color: '#4a5568' }} />
                <span>点击文章卡片可使用 openclaw agent 下载全文并翻译，翻译完成后自动打开中英对照页</span>
              </div>

              {/* AI: 新闻分组卡片 */}
              <div className="space-y-6">
                {newsGroups.map((group, gi) => (
                  <div key={gi}>
                    <h2
                      className="text-sm font-semibold mb-2.5 pb-1.5 border-b"
                      style={{ color: '#63b3ed', borderColor: '#2d3148' }}
                    >
                      {group.heading}
                    </h2>
                    <div className="space-y-1.5">
                      {group.items.map((item, ii) => (
                        <NewsCard key={ii} item={item} date={selectedDate} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {newsGroups.length === 0 && (
                <div className="text-center py-16" style={{ color: '#4a5568' }}>
                  <p className="text-sm">该日期暂无内容</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* AI: 全局动画 */}
      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  )
}
/* AI end: AI要闻页面 */
