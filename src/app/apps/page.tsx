/* 应用管理页 — /apps */
'use client';

import { LayoutGrid, Plus } from 'lucide-react';

export default function AppsPage() {
  return (
    <div className="p-8 max-w-4xl">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            应用
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理和配置你的应用集成
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors opacity-50 cursor-not-allowed"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
        >
          <Plus size={16} />
          添加应用
        </button>
      </div>

      {/* 空状态 */}
      <div
        className="text-center py-16 rounded-xl border"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-background)',
        }}
      >
        <LayoutGrid
          size={48}
          className="mx-auto mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        />
        <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          应用管理
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          在这里管理和配置你的应用集成
        </p>
      </div>
    </div>
  );
}
