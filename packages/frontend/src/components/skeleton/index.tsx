export function SkeletonSidebarList({ itemCount = 3 }: { itemCount?: number }) {
  return (
    <div className="space-y-2 p-2">
      {[...Array(itemCount)].map((_, i) => (
        <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" />
      ))}
    </div>
  )
}

export function SkeletonList({
  itemCount = 3,
  itemHeight = '16px',
  showAvatar = false,
  showSubtitle = true,
}: {
  itemCount?: number
  itemHeight?: string
  showAvatar?: boolean
  showSubtitle?: boolean
}) {
  return (
    <div className="space-y-3">
      {[...Array(itemCount)].map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          {showAvatar && (
            <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse flex-shrink-0" />
          )}
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ height: itemHeight, width: '70%' }} />
            {showSubtitle && (
              <div className="h-3 bg-gray-200 rounded animate-pulse" style={{ width: '50%' }} />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonPage({
  titleLines = 1,
  cardCount = 3,
  gridClassName = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  showActionBar = false,
}: {
  titleLines?: number
  cardCount?: number
  gridClassName?: string
  showActionBar?: boolean
}) {
  return (
    <div className="p-8 max-w-6xl">
      {/* 标题骨架 */}
      <div className="mb-6">
        {[...Array(titleLines)].map((_, i) => (
          <div key={i} className="h-6 bg-gray-200 rounded animate-pulse mb-2" style={{ width: i === 0 ? '200px' : '140px' }} />
        ))}
      </div>

      {/* 操作栏骨架 */}
      {showActionBar && (
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-10 bg-gray-200 rounded-lg animate-pulse" />
          <div className="h-10 w-24 bg-gray-200 rounded-lg animate-pulse" />
        </div>
      )}

      {/* 卡片网格骨架 */}
      <div className={`grid ${gridClassName} gap-4`}>
        {[...Array(cardCount)].map((_, i) => (
          <div key={i} className="rounded-xl p-5 animate-pulse" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', height: '180px' }} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonDetailPage({
  showSidebar = false,
  sidebarWidth = '280px',
}: {
  showSidebar?: boolean
  sidebarWidth?: string
}) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 顶部栏骨架 */}
      <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-8 w-24 bg-gray-200 rounded-lg animate-pulse" />
        <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
      </div>

      {/* 主体骨架 */}
      <div className="flex flex-1 overflow-hidden">
        {showSidebar && (
          <div className="flex-shrink-0 p-3" style={{ width: sidebarWidth, borderRight: '1px solid var(--color-border)' }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-9 bg-gray-200 rounded-lg animate-pulse mb-1" />
            ))}
          </div>
        )}
        <div className="flex-1 p-6">
          <div className="space-y-4 max-w-lg">
            {[...Array(4)].map((_, i) => (
              <div key={i}>
                <div className="h-3 w-20 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-10 bg-gray-200 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function SkeletonChatPage() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 顶部栏骨架 */}
      <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="flex-1" />
        <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
      </div>

      {/* 主体骨架 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 聊天区域 */}
        <div className="flex-1 flex flex-col">
          {/* 消息列表骨架 */}
          <div className="flex-1 p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[70%] space-y-2">
                  <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: `${80 - i * 10}%` }} />
                  {i % 2 === 1 && (
                    <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width: '60%' }} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 输入框骨架 */}
          <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="h-12 bg-gray-200 rounded-lg animate-pulse" />
          </div>
        </div>

        {/* 侧边栏骨架 */}
        <div className="w-72 flex-shrink-0 p-4 space-y-3" style={{ borderLeft: '1px solid var(--color-border)' }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-9 bg-gray-200 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  )
}
