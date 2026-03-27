/* AI start: AI要闻 中英文对照阅读页 */
'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ExternalLink, BookOpen, Loader2, AlertTriangle } from 'lucide-react'

interface ArticleCache {
  url: string
  slug: string
  date: string
  title: string
  titleCN: string
  paragraphs: { en: string; cn: string }[]
  originalText: string
  fetchedAt: string
  translatedAt: string
  wordCount: number
  status: 'ok' | 'failed' | 'partial'
  error?: string
}

export default function ArticleReadPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const slug = params.slug as string
  const date = searchParams.get('date') ?? ''

  const [article, setArticle] = useState<ArticleCache | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug || !date) { setError('参数缺失'); setLoading(false); return }
    const load = async () => {
      try {
        const res = await fetch(`/api/ai-news/articles/${slug}?date=${date}`)
        if (res.ok) {
          setArticle(await res.json() as ArticleCache)
        } else {
          setError('文章未找到，请先在 AI 要闻页面触发下载翻译')
        }
      } catch {
        setError('加载失败')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [slug, date])

  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#0f1117' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} style={{ color: '#4299e1', animation: 'spin 1s linear infinite' }} />
        <p className="text-sm" style={{ color: '#8892a4' }}>加载中…</p>
      </div>
      <style jsx global>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  )

  if (error || !article) return (
    <div className="flex items-center justify-center h-screen" style={{ background: '#0f1117' }}>
      <div className="flex flex-col items-center gap-3 text-center px-8">
        <AlertTriangle size={32} style={{ color: '#fc8181' }} />
        <p className="text-sm" style={{ color: '#fc8181' }}>{error || '未找到文章'}</p>
        <button onClick={() => window.close()} className="text-xs px-3 py-1.5 rounded" style={{ background: '#1e2130', color: '#8892a4', border: '1px solid #2d3148' }}>
          关闭
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen pb-16" style={{ background: '#0f1117', color: '#e2e8f0' }}>
      {/* AI: 顶部导航栏 */}
      <div
        className="sticky top-0 z-10 px-6 py-3 border-b flex items-center justify-between"
        style={{ background: '#1a1d27', borderColor: '#2d3148' }}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={15} style={{ color: '#63b3ed' }} />
          <span className="text-xs font-medium" style={{ color: '#8892a4' }}>AI 要闻 · 中英文对照</span>
          <span className="text-xs" style={{ color: '#4a5568' }}>·</span>
          <span className="text-xs" style={{ color: '#4a5568' }}>{article.date}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: '#4a5568' }}>约 {article.wordCount.toLocaleString()} 词</span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
            style={{ background: '#1e3a5f', border: '1px solid #2b6cb0', color: '#63b3ed' }}
          >
            <ExternalLink size={11} /> 查看原文
          </a>
        </div>
      </div>

      {/* AI: 文章主体 */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* AI: 标题区 */}
        <div className="mb-8 pb-6 border-b" style={{ borderColor: '#2d3148' }}>
          {/* AI: 中文标题（大） */}
          <h1 className="text-xl font-bold mb-2 leading-snug" style={{ color: '#e2e8f0' }}>
            {article.titleCN}
          </h1>
          {/* AI: 英文原标题（小，灰色） */}
          <h2 className="text-sm leading-snug" style={{ color: '#4a5568', fontStyle: 'italic' }}>
            {article.title}
          </h2>
        </div>

        {/* AI: 中英文对照段落（兼容旧格式 translatedText） */}
        <div className="space-y-6">
          {(article.paragraphs ?? (article as unknown as { translatedText?: string }).translatedText
            ? [{ cn: (article as unknown as { translatedText?: string }).translatedText ?? '', en: article.originalText ?? '' }]
            : []
          ).map((para, idx) => (
            <div key={idx} className="rounded-xl overflow-hidden" style={{ border: '1px solid #2d3148' }}>
              {/* AI: 中文翻译（上方，白色） */}
              <div
                className="px-5 py-3 text-sm leading-relaxed"
                style={{ background: '#161a26', borderBottom: '1px solid #2d3148', color: '#e2e8f0', lineHeight: '1.8' }}
              >
                {para.cn}
              </div>
              {/* AI: 英文原文（下方，灰色斜体） */}
              <div
                className="px-5 py-3 text-xs leading-relaxed"
                style={{ background: '#1a1d27', color: '#4a5568', fontStyle: 'italic', lineHeight: '1.7' }}
              >
                {para.en}
              </div>
            </div>
          ))}
        </div>

        {/* AI: 底部来源 */}
        <div className="mt-10 pt-6 border-t flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
          <span className="text-xs" style={{ color: '#4a5568' }}>
            由 ARM AI要闻 · openclaw agent 翻译
          </span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs"
            style={{ color: '#4299e1' }}
          >
            <ExternalLink size={10} /> {article.url.slice(0, 60)}{article.url.length > 60 ? '…' : ''}
          </a>
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
/* AI end: AI要闻 中英文对照阅读页 */
