/* AI start: 新建工作流弹窗 */
'use client'
import { useState } from 'react'
import type { WorkflowConfig } from '@/lib/types'
import { X } from 'lucide-react'

interface NewWorkflowModalProps {
  onClose: () => void
  onCreated: (wf: WorkflowConfig) => void
}

export default function NewWorkflowModal({ onClose, onCreated }: NewWorkflowModalProps) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // AI: 工作流名称自动生成 ID（拼音 slug 简化版，纯英文/数字/横线）
  const handleNameChange = (v: string) => {
    setName(v)
    // AI: 简单地将中文转为拼音占位 slug（直接用时间戳替代真实转拼音）
    if (!id) {
      const slug = v
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        || `workflow-${Date.now()}`
      setId(slug)
    }
  }

  const handleCreate = async () => {
    if (!name.trim() || !id.trim()) {
      setErr('名称和 ID 不能为空')
      return
    }
    // AI: ID 只允许字母数字横线
    if (!/^[a-z0-9-]+$/.test(id)) {
      setErr('ID 只允许小写字母、数字、横线')
      return
    }
    setSaving(true)
    setErr(null)
    const wf: WorkflowConfig = {
      id,
      name,
      description: desc || undefined,
      steps: [
        { id: 'start', name: '开始', agent: 'dev' },
      ],
    }
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wf),
      })
      if (!res.ok) throw new Error('保存失败')
      onCreated(wf)
      onClose()
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-xl p-6" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
        {/* AI: 弹窗标题 */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">⚙️ 新建工作流</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* AI: 工作流名称 */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#8892a4' }}>工作流名称 *</label>
            <input
              autoFocus
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="例：需求开发流"
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            />
          </div>

          {/* AI: 工作流 ID */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#8892a4' }}>工作流 ID *（文件名）</label>
            <input
              value={id}
              onChange={e => setId(e.target.value)}
              placeholder="例：dev-flow（仅小写字母、数字、横线）"
              className="w-full px-3 py-2 rounded-lg text-sm font-mono"
              style={{ background: '#0f1117', border: '1px solid #2d3148', color: '#a0aec0' }}
            />
          </div>

          {/* AI: 描述 */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: '#8892a4' }}>描述（可选）</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="简单描述工作流用途..."
              className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
              style={{ background: '#0f1117', border: '1px solid #2d3148' }}
            />
          </div>

          {/* AI: 错误提示 */}
          {err && (
            <p className="text-xs" style={{ color: '#fc8181' }}>{err}</p>
          )}

          {/* AI: 按钮行 */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm"
              style={{ background: '#1a1d2e', border: '1px solid #2d3148', color: '#8892a4' }}
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: saving ? '#1e4080' : '#3b82f6' }}
            >
              {saving ? '创建中...' : '创建工作流'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
/* AI end: 新建工作流弹窗 */
