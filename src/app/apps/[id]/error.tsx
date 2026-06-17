'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function AppDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const params = useParams()
  const router = useRouter()

  useEffect(() => {
    console.error('App detail error:', error)
  }, [error])

  return (
    <div className="p-6" style={{ background: 'var(--color-background)' }}>
      {/* 面包屑导航 */}
      <div className="mb-6">
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => router.push('/apps')}
            className="hover:underline"
            style={{ color: 'var(--color-text-muted)' }}
          >
            应用列表
          </button>
          <span style={{ color: 'var(--color-text-muted)' }}>/</span>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {params.id as string}
          </span>
        </nav>
      </div>

      {/* 错误内容 */}
      <div
        className="rounded-xl p-8 text-center"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: 'var(--color-surface-elevated)' }}
        >
          <svg
            className="w-6 h-6"
            style={{ color: 'var(--color-status-failed)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          应用详情加载失败
        </h3>

        <p
          className="mb-6 max-w-md mx-auto"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {error.message || '无法加载应用详情，应用可能已被删除或不存在'}
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            重试
          </button>
          <button
            onClick={() => router.push('/apps')}
            className="px-5 py-2 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--color-surface-elevated)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            返回应用列表
          </button>
        </div>

        {/* 开发环境显示错误详情 */}
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-6 text-left">
            <summary
              className="cursor-pointer text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              查看错误详情
            </summary>
            <pre
              className="mt-2 p-4 rounded-lg text-xs overflow-auto"
              style={{
                background: 'var(--color-surface-elevated)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
