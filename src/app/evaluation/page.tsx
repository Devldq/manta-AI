/* 评估中心页 — /evaluation (Phase 4 实现) */
'use client'

import { BarChart3 } from 'lucide-react'

export default function EvaluationPage() {
  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            评估中心
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            RAGAs 评估流水线和 Agent 行为测评
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
        <BarChart3
          size={48}
          className="mx-auto mb-4"
          style={{ color: 'var(--color-text-muted)' }}
        />
        <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          评估功能开发中
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          此功能将在 Phase 4 中实现，届时将支持 RAGAs 7 维度评估和 Agent 行为测评。
        </p>
      </div>
    </div>
  )
}
