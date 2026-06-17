'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // 记录错误到控制台
    console.error('Global error:', error)
  }, [error])

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[400px] p-8"
      style={{ background: 'var(--color-background)' }}
    >
      <div
        className="max-w-md w-full rounded-xl p-8 text-center"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* 错误图标 */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ background: 'var(--color-surface-elevated)' }}
        >
          <svg
            className="w-8 h-8"
            style={{ color: 'var(--color-status-failed)' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        {/* 错误标题 */}
        <h2
          className="text-xl font-semibold mb-3"
          style={{ color: 'var(--color-text-primary)' }}
        >
          出现了一些问题
        </h2>

        {/* 错误描述 */}
        <p
          className="mb-6"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {error.message || '发生了意外错误，请尝试刷新页面'}
        </p>

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            重试
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--color-surface-elevated)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          >
            刷新页面
          </button>
        </div>

        {/* 错误详情（仅开发环境） */}
        {process.env.NODE_ENV === 'development' && error.digest && (
          <p
            className="mt-4 text-xs font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            错误 ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
