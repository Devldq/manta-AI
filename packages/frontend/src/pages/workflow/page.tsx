import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ArrowLeft, Workflow, Settings, Trash2 } from 'lucide-react'
import { useWorkflowStore } from '@/stores/workflow-store'
import { NodePalette } from '@/components/workflow/NodePalette'
import { NodeConfigPanel } from '@/components/workflow/NodeConfigPanel'
import { WorkflowToolbar } from '@/components/workflow/WorkflowToolbar'
import { WorkflowEditor } from '@/components/workflow/WorkflowEditor'
import type { WorkflowStepType } from '@manta/shared'
import { SkeletonPage } from '@/components/skeleton'

export default function WorkflowPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('id')
  
  const {
    workflows,
    currentWorkflow,
    loading,
    error,
    fetchWorkflows,
    createWorkflow,
    deleteWorkflow,
    loadWorkflow,
    resetEditor,
  } = useWorkflowStore()

  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newWorkflow, setNewWorkflow] = useState({ name: '', description: '' })
  const [isEditing, setIsEditing] = useState(false)

  // 加载工作流列表
  useEffect(() => {
    fetchWorkflows()
  }, [fetchWorkflows])

  // 如果有编辑ID，加载工作流
  useEffect(() => {
    if (editId) {
      loadWorkflow(editId)
      setIsEditing(true)
    } else {
      resetEditor()
      setIsEditing(false)
    }
  }, [editId, loadWorkflow, resetEditor])

  // 创建工作流
  const handleCreate = async () => {
    if (!newWorkflow.name.trim()) {
      alert('工作流名称不能为空')
      return
    }

    const workflow = await createWorkflow({
      name: newWorkflow.name.trim(),
      description: newWorkflow.description.trim(),
    })

    if (workflow) {
      setIsCreateOpen(false)
      setNewWorkflow({ name: '', description: '' })
      // 跳转到编辑页面
      navigate(`/workflow?id=${workflow.id}`)
    } else {
      alert('创建工作流失败')
    }
  }

  // 删除工作流
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定要删除此工作流吗？')) return

    const success = await deleteWorkflow(id)
    if (success) {
      if (editId === id) {
        navigate('/workflow')
      }
    } else {
      alert('删除工作流失败')
    }
  }

  // 运行工作流（暂未实现）
  const handleRun = () => {
    alert('工作流执行功能开发中')
  }

  // 导出工作流（暂未实现）
  const handleExport = () => {
    alert('导出功能开发中')
  }

  // 导入工作流（暂未实现）
  const handleImport = () => {
    alert('导入功能开发中')
  }

  // 节点拖拽开始
  const handleNodeDragStart = (type: WorkflowStepType) => {
    // 可以在这里添加拖拽开始的逻辑
  }

  // 编辑模式 - 显示可视化编辑器
  if (isEditing && editId) {
    return (
      <div className="flex flex-col h-full">
        {/* 工具栏 */}
        <WorkflowToolbar 
          onRun={handleRun}
          onExport={handleExport}
          onImport={handleImport}
          onBack={() => navigate('/workflow')}
        />

        <div className="flex flex-1 overflow-hidden">
          {/* 左侧节点面板 */}
          <NodePalette onDragStart={handleNodeDragStart} />

          {/* 中间画布 */}
          <div className="flex-1 relative">
            <WorkflowEditor className="w-full h-full" />
          </div>

          {/* 右侧配置面板 */}
          <NodeConfigPanel />
        </div>
      </div>
    )
  }

  // 列表模式 - 显示工作流列表
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-3xl font-bold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            工作流管理
          </h1>
          <p
            className="mt-2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            创建和管理自动化工作流，编排智能体任务
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
        >
          <Plus className="w-4 h-4" />
          新建工作流
        </button>
      </div>

      {/* 创建对话框 */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setIsCreateOpen(false)}
          />
          <div
            className="relative z-50 w-full max-w-md p-6 rounded-lg shadow-xl"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <h2
              className="text-lg font-semibold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              创建新工作流
            </h2>
            <p
              className="text-sm mb-6"
              style={{ color: 'var(--color-text-muted)' }}
            >
              工作流用于编排多个智能体任务，实现自动化处理流程。
            </p>
            
            <div className="space-y-4">
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  名称
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                  }}
                  value={newWorkflow.name}
                  onChange={(e) => setNewWorkflow({ ...newWorkflow, name: e.target.value })}
                  placeholder="输入工作流名称"
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  描述
                </label>
                <textarea
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                  }}
                  value={newWorkflow.description}
                  onChange={(e) => setNewWorkflow({ ...newWorkflow, description: e.target.value })}
                  placeholder="输入工作流描述（可选）"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-md text-sm border"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--color-accent)',
                  color: 'var(--color-text-inverse)',
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {loading && <SkeletonPage titleLines={1} cardCount={6} gridClassName="grid-cols-1 md:grid-cols-2 lg:grid-cols-3" showActionBar />}

      {/* 错误信息 */}
      {error && (
        <div
          className="text-center py-8 rounded-lg"
          style={{
            background: 'var(--color-status-failed)10',
            color: 'var(--color-status-failed)',
          }}
        >
          {error}
        </div>
      )}

      {/* 工作流列表 */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="rounded-xl border cursor-pointer hover:shadow-lg transition-all"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
              }}
              onClick={() => navigate(`/workflow?id=${workflow.id}`)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{
                        background: 'var(--color-accent)15',
                        color: 'var(--color-accent)',
                      }}
                    >
                      <Workflow className="w-5 h-5" />
                    </div>
                    <div>
                      <h3
                        className="font-semibold"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {workflow.name}
                      </h3>
                      {workflow.description && (
                        <p
                          className="text-sm mt-1 line-clamp-2"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {workflow.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div
                    className="text-xs"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {workflow.steps?.length || 0} 个步骤
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/workflow?id=${workflow.id}`)
                      }}
                      title="编辑"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={(e) => handleDelete(workflow.id, e)}
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && workflows.length === 0 && (
        <div className="text-center py-20">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'var(--color-accent)10',
              color: 'var(--color-accent)',
            }}
          >
            <Workflow className="w-10 h-10" />
          </div>
          <h3
            className="text-lg font-medium mb-2"
            style={{ color: 'var(--color-text-primary)' }}
          >
            暂无工作流
          </h3>
          <p
            className="mb-6"
            style={{ color: 'var(--color-text-muted)' }}
          >
            创建您的第一个工作流来编排智能体任务
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium mx-auto"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-text-inverse)',
            }}
          >
            <Plus className="w-4 h-4" />
            创建工作流
          </button>
        </div>
      )}
    </div>
  )
}
