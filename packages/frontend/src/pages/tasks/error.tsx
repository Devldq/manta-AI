import { useEffect } from 'react'

export default function TasksError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Tasks page error:', error)
  }, [error])

  return (
    <div className="flex h-full">
      {/* 左侧边栏保持结构 */}
      <div
        className="w-64 border-r flex-shrink-0 p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="h-10 rounded-lg mb-4"
          style={{ background: 'var(--color-surface)' }}
        />
        {/* 侧边栏占位 */}
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 rounded-lg"
              style={{ background: 'var(--color-surface)' }}
            />
          ))}
        </div>
      </div>

      {/* 右侧错误内容 */}
      <div
        className="flex-1 flex items-center justify-center p-8"
        style={{ background: 'var(--color-background)' }}
      >
        <div
          className="max-w-md w-full rounded-xl p-8 text-center"
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
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>

          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--color-text-primary)' }}
          >
            对话加载失败
          </h3>

          <p
            className="mb-6"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {error.message || '无法加载对话内容，请重试'}
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
              重新加载
            </button>
            <button
              onClick={() => window.location.href = '/tasks'}
              className="px-5 py-2 rounded-lg font-medium transition-all duration-200 hover:opacity-90"
              style={{
                background: 'var(--color-surface-elevated)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            >
              返回列表
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
