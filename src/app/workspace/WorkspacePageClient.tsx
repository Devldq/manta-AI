'use client'

import { useEffect, useState, useRef } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Plus, Settings, Trash2, FolderOpen } from 'lucide-react'
import { SkeletonPage } from '@/app/components/skeleton'

export default function WorkspacePageClient({ initialWorkspaces }: { initialWorkspaces?: any[] }) {
  const { items, loading, error, fetchList, createWorkspace, deleteWorkspace } = useWorkspaceStore()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ name: '', description: '' })
  const inputRef = useRef<HTMLInputElement>(null)

  // 如果有 initialWorkspaces，注入到 store
  useEffect(() => {
    if (initialWorkspaces && initialWorkspaces.length > 0 && items.length === 0) {
      useWorkspaceStore.setState({ items: initialWorkspaces, loading: false })
    }
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    if (isCreateOpen) {
      setNewWorkspace({ name: '', description: '' })
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isCreateOpen])

  const handleCreate = async () => {
    if (!newWorkspace.name.trim()) {
      alert('工作空间名称不能为空')
      return
    }
    const workspace = await createWorkspace({ name: newWorkspace.name.trim(), description: newWorkspace.description.trim() })
    if (workspace) {
      setIsCreateOpen(false)
      setNewWorkspace({ name: '', description: '' })
    } else {
      alert('创建工作空间失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除此工作空间吗？')) return
    await deleteWorkspace(id)
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            工作空间管理
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            管理您的工作空间，配置智能体应用、知识库和工作流
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
        >
          <Plus size={16} />
          新建工作空间
        </button>
      </div>

      {/* 创建对话框 */}
      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setIsCreateOpen(false)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl p-6"
            style={{
              background: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              创建新工作空间
            </h2>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--color-text-muted)' }}
            >
              工作空间是您组织智能体应用、知识库和工作的地方。
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleCreate() }}>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                名称 *
              </label>
              <input
                ref={inputRef}
                type="text"
                value={newWorkspace.name}
                onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
                placeholder="输入工作空间名称"
                maxLength={30}
                className="w-full px-3 py-2 rounded-lg text-sm mb-3 outline-none transition-colors"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />

              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                描述（可选）
              </label>
              <textarea
                value={newWorkspace.description}
                onChange={(e) => setNewWorkspace({ ...newWorkspace, description: e.target.value })}
                placeholder="输入工作空间描述..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm mb-4 outline-none resize-none transition-colors"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
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
                  type="submit"
                  disabled={!newWorkspace.name.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity"
                  style={{
                    background: 'var(--color-accent)',
                    color: 'var(--color-text-inverse)',
                    opacity: newWorkspace.name.trim() ? 1 : 0.5,
                  }}
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {loading && <SkeletonPage titleLines={1} cardCount={3} gridClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3" showActionBar />}

      {/* 错误信息 */}
      {error && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
          }}
        >
          {error}
        </div>
      )}

      {/* 工作空间列表 */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((workspace) => (
            <div
              key={workspace.id}
              className="group relative rounded-xl p-5 transition-all hover:shadow-lg"
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              {/* 头部 */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      background: 'var(--color-accent)15',
                      color: 'var(--color-accent)',
                    }}
                  >
                    <FolderOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3
                      className="font-medium text-sm"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {workspace.name}
                    </h3>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1 rounded-md transition-colors"
                    style={{ color: 'var(--color-text-muted)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--color-surface-elevated)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    className="p-1 rounded-md transition-colors"
                    style={{ color: '#ef4444' }}
                    onClick={() => handleDelete(workspace.id)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 描述 */}
              <p
                className="text-xs mb-4 line-clamp-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {workspace.description || '暂无描述'}
              </p>

              {/* 底部 */}
              <div className="flex items-center justify-between">
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span>创建于: {new Date(workspace.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  <span>更新于: {new Date(workspace.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && items.length === 0 && (
        <div
          className="text-center py-20 rounded-xl border"
          style={{
            borderColor: 'var(--color-border)',
            background: 'var(--color-background)',
          }}
        >
          <FolderOpen
            size={48}
            className="mx-auto mb-4"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            暂无工作空间
          </p>
          <p className="text-xs mb-6" style={{ color: 'var(--color-text-muted)' }}>
            点击上方按钮创建您的第一个工作空间
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            <Plus size={16} />
            新建工作空间
          </button>
        </div>
      )}
    </div>
  )
}
