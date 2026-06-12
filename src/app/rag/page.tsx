/* 知识库管理页 — /rag (Phase 3 实现) */
'use client'

import { Database } from 'lucide-react'

export default function RagPage() {
  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            知识库管理
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理 RAG 知识库和文档处理流水线
          </p>
        </div>
      </div>

      <div
        className="text-center py-20 rounded-xl border"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-background)',
        }}
      >
        <Database
          size={48}
          className="mx-auto mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        />
        <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          知识库功能开发中
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          此功能将在 Phase 3 中实现，届时将支持文档上传、分块预览和向量检索。
        </p>
      </div>
    </div>
  )
}
