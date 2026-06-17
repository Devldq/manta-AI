export default function SettingsLoading() {
  return (
    <div className="flex h-full">
      {/* 左侧目录骨架 */}
      <div
        className="w-64 border-r flex-shrink-0 p-6 space-y-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="h-8 rounded-md animate-pulse mb-6"
          style={{ background: 'var(--color-surface)', width: '60%' }}
        />
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={`menu-${i}`}
            className="h-10 rounded-lg animate-pulse"
            style={{
              background: 'var(--color-surface)',
              width: `${80 + (i % 3) * 5}%`,
            }}
          />
        ))}
      </div>

      {/* 右侧内容区骨架 */}
      <div className="flex-1 p-8 space-y-8">
        {/* 标题 */}
        <div
          className="h-8 rounded-md animate-pulse"
          style={{ background: 'var(--color-surface)', width: '30%' }}
        />

        {/* 内容块 */}
        {[1, 2].map((i) => (
          <div
            key={`section-${i}`}
            className="rounded-xl p-6 space-y-4 animate-pulse"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              className="h-6 rounded-md"
              style={{ background: 'var(--color-surface-elevated)', width: '40%' }}
            />
            <div className="space-y-3">
              {[1, 2, 3].map((j) => (
                <div
                  key={`line-${i}-${j}`}
                  className="h-4 rounded-md"
                  style={{
                    background: 'var(--color-surface-elevated)',
                    width: `${90 - j * 15}%`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
