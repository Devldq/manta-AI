'use client'

import { useEffect } from 'react'

export default function AppsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Apps page error:', error)
  }, [error])

  return (
    <div className="p-6" style={{ background: 'var(--color-background)' }}>
      {/* 页面标题占位 */}
      <div className="mb-6">
        <div
          className="h-8 rounded-md w-48 mb-4"
          style={{ background: 'var(--color-surface)' }}
        />
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
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
        </div>

        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--color-text-primary)' }}
        >
          应用加载失败
        </h3>

        <p
          className="mb-6 max-w-md mx-auto"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {error.message || '无法加载应用列表，请检查网络连接后重试'}
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
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--color-surface-elevated)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            刷新页面
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
