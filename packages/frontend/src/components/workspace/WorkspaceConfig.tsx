import { useState, useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Save, X } from 'lucide-react'

interface WorkspaceConfigProps {
  workspaceId: string
  onClose: () => void
}

export function WorkspaceConfig({ workspaceId, onClose }: WorkspaceConfigProps) {
  const { items, updateWorkspace } = useWorkspaceStore()
  const workspace = items.find((w) => w.id === workspaceId)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
  })

  useEffect(() => {
    if (workspace) {
      setFormData({
        name: workspace.name,
        description: workspace.description || '',
      })
    }
  }, [workspace])

  if (!workspace) {
    return (
      <div
        className="text-center py-8 text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        工作空间不存在
      </div>
    )
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('工作空间名称不能为空')
      return
    }
    const updated = await updateWorkspace(workspaceId, {
      name: formData.name.trim(),
      description: formData.description.trim(),
    })
    if (updated) {
      onClose()
    } else {
      alert('更新失败')
    }
  }

  return (
    <div
      className="w-full max-w-2xl rounded-xl overflow-hidden"
      style={{
        background: 'var(--color-background)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            编辑工作空间
          </h2>
          <p
            className="text-sm mt-0.5"
            style={{ color: 'var(--color-text-muted)' }}
          >
            修改工作空间的基本信息
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-surface-elevated)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 内容 */}
      <div className="px-6 py-5 space-y-5">
        <div className="space-y-2">
          <label
            className="block text-xs font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            名称
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="输入工作空间名称"
            maxLength={30}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        <div className="space-y-2">
          <label
            className="block text-xs font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            描述
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="输入工作空间描述（可选）"
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none transition-colors"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors"
            style={{
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
              background: 'transparent',
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!formData.name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
              opacity: formData.name.trim() ? 1 : 0.5,
            }}
          >
            <Save className="h-4 w-4" />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
