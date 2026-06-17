/**
 * 通用骨架屏组件
 * 用于页面加载时展示占位 UI，避免白屏等待
 * 使用 Tailwind animate-pulse + 项目 CSS 变量
 */

import React from 'react'

interface SkeletonPageProps {
  /** 标题骨架行数（默认 1） */
  titleLines?: number
  /** 卡片/内容块数量（默认 3） */
  cardCount?: number
  /** 卡片布局网格类（默认 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'） */
  gridClassName?: string
  /** 是否显示顶部操作栏骨架（默认 false） */
  showActionBar?: boolean
  /** 自定义额外 className */
  className?: string
  /** 子组件（用于自定义骨架内容） */
  children?: React.ReactNode
}

/**
 * 通用页面骨架屏
 * 适用于卡片网格布局的页面（如 apps、workspace、workflow）
 */
export function SkeletonPage({
  titleLines = 1,
  cardCount = 3,
  gridClassName = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  showActionBar = false,
  className = '',
  children,
}: SkeletonPageProps) {
  return (
    <div className={`p-6 space-y-6 ${className}`}>
      {/* 标题区域骨架 */}
      <div className="space-y-3">
        {Array.from({ length: titleLines }).map((_, i) => (
          <div
            key={`title-${i}`}
            className="h-8 rounded-md animate-pulse"
            style={{
              background: 'var(--color-surface)',
              width: i === titleLines - 1 ? '40%' : '60%',
            }}
          />
        ))}
      </div>

      {/* 操作栏骨架（可选） */}
      {showActionBar && (
        <div className="flex gap-3">
          <div
            className="h-10 w-32 rounded-lg animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
          <div
            className="h-10 w-24 rounded-lg animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
          <div className="flex-1" />
          <div
            className="h-10 w-48 rounded-lg animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
        </div>
      )}

      {/* 内容区域 */}
      {children || (
        <div className={`grid ${gridClassName} gap-4`}>
          {Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard key={`card-${i}`} />
          ))}
        </div>
      )}
    </div>
  )
}

interface SkeletonCardProps {
  /** 卡片高度（默认 '180px'） */
  height?: string
  /** 是否显示内容行（默认 true） */
  showContent?: boolean
  /** 内容行数（默认 3） */
  contentLines?: number
  /** 自定义 className */
  className?: string
}

/**
 * 单卡片骨架屏
 * 适用于卡片列表项
 */
export function SkeletonCard({
  height = '180px',
  showContent = true,
  contentLines = 3,
  className = '',
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-xl p-5 animate-pulse ${className}`}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        height,
      }}
    >
      {showContent && (
        <div className="space-y-3">
          {/* 头部行 */}
          <div
            className="h-5 rounded-md"
            style={{ background: 'var(--color-surface-elevated)', width: '70%' }}
          />
          {/* 内容行 */}
          {Array.from({ length: contentLines }).map((_, i) => (
            <div
              key={`line-${i}`}
              className="h-3 rounded-md"
              style={{
                background: 'var(--color-surface-elevated)',
                width: `${90 - i * 15}%`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface SkeletonListProps {
  /** 列表项数量（默认 5） */
  itemCount?: number
  /** 列表项高度（默认 '48px'） */
  itemHeight?: string
  /** 是否显示头像/图标占位（默认 false） */
  showAvatar?: boolean
  /** 是否显示副标题（默认 true） */
  showSubtitle?: boolean
  /** 自定义 className */
  className?: string
}

/**
 * 列表项骨架屏
 * 适用于侧边栏列表、简单列表等
 */
export function SkeletonList({
  itemCount = 5,
  itemHeight = '48px',
  showAvatar = false,
  showSubtitle = true,
  className = '',
}: SkeletonListProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: itemCount }).map((_, i) => (
        <div
          key={`item-${i}`}
          className="flex items-center gap-3 p-3 rounded-lg animate-pulse"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            minHeight: itemHeight,
          }}
        >
          {/* 头像/图标占位 */}
          {showAvatar && (
            <div
              className="rounded-full flex-shrink-0"
              style={{
                width: '32px',
                height: '32px',
                background: 'var(--color-surface-elevated)',
              }}
            />
          )}

          {/* 文本内容 */}
          <div className="flex-1 space-y-2">
            <div
              className="h-4 rounded-md"
              style={{
                background: 'var(--color-surface-elevated)',
                width: `${70 + (i % 3) * 10}%`,
              }}
            />
            {showSubtitle && (
              <div
                className="h-3 rounded-md"
                style={{
                  background: 'var(--color-surface-elevated)',
                  width: `${50 + (i % 4) * 8}%`,
                }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 侧边栏列表骨架屏
 * 专门用于 ConversationList 和 WorkspaceList
 */
export function SkeletonSidebarList({ itemCount = 5 }: { itemCount?: number }) {
  return (
    <div className="px-2 space-y-1">
      {Array.from({ length: itemCount }).map((_, i) => (
        <div
          key={`sidebar-${i}`}
          className="flex items-center gap-3 px-3 py-2 rounded-lg animate-pulse"
          style={{ minHeight: '40px' }}
        >
          <div
            className="w-5 h-5 rounded flex-shrink-0"
            style={{ background: 'var(--color-surface-elevated)' }}
          />
          <div
            className="h-4 rounded flex-1"
            style={{
              background: 'var(--color-surface-elevated)',
              width: `${60 + (i % 3) * 12}%`,
            }}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * 聊天页面骨架屏
 * 用于 Tasks 页面的 Suspense fallback
 */
export function SkeletonChatPage() {
  return (
    <div className="flex h-full">
      {/* 左侧边栏骨架 */}
      <div
        className="w-64 border-r flex-shrink-0 p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {/* 搜索框 */}
        <div
          className="h-10 rounded-lg animate-pulse"
          style={{ background: 'var(--color-surface)' }}
        />
        {/* 列表项 */}
        <SkeletonList itemCount={6} itemHeight="40px" showAvatar={false} showSubtitle={false} />
      </div>

      {/* 右侧聊天区骨架 */}
      <div className="flex-1 flex flex-col">
        {/* 聊天头部 */}
        <div
          className="h-16 border-b flex items-center px-6"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="h-6 w-48 rounded animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
        </div>

        {/* 消息区域 */}
        <div className="flex-1 p-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={`msg-${i}`}
              className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`rounded-2xl animate-pulse ${
                  i % 2 === 0 ? 'rounded-br-md' : 'rounded-bl-md'
                }`}
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border-subtle)',
                  width: `${40 + i * 10}%`,
                  height: '80px',
                }}
              />
            </div>
          ))}
        </div>

        {/* 输入框骨架 */}
        <div
          className="border-t p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div
            className="h-12 rounded-xl animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 详情页面骨架屏
 * 用于应用详情、构建器等页面
 */
export function SkeletonDetailPage({
  showSidebar = false,
  sidebarWidth = '280px',
}: {
  showSidebar?: boolean
  sidebarWidth?: string
}) {
  return (
    <div className="flex h-full">
      {/* 可选侧边栏 */}
      {showSidebar && (
        <div
          className="border-r flex-shrink-0 p-4 space-y-3"
          style={{
            borderColor: 'var(--color-border)',
            width: sidebarWidth,
          }}
        >
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{ background: 'var(--color-surface)' }}
          />
          <SkeletonList itemCount={8} itemHeight="36px" showSubtitle={false} />
        </div>
      )}

      {/* 主内容区 */}
      <div className="flex-1 p-6 space-y-6">
        {/* 标题区域 */}
        <div className="space-y-3">
          <div
            className="h-8 rounded-md animate-pulse"
            style={{ background: 'var(--color-surface)', width: '50%' }}
          />
          <div
            className="h-4 rounded-md animate-pulse"
            style={{ background: 'var(--color-surface)', width: '30%' }}
          />
        </div>

        {/* 内容块 */}
        <div className="grid grid-cols-2 gap-6">
          <div
            className="rounded-xl p-6 animate-pulse"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              height: '300px',
            }}
          />
          <div
            className="rounded-xl p-6 animate-pulse"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              height: '300px',
            }}
          />
        </div>

        {/* 底部内容 */}
        <div
          className="rounded-xl p-6 animate-pulse"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            height: '200px',
          }}
        />
      </div>
    </div>
  )
}
