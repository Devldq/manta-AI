'use client'

import { useState, useEffect } from 'react'
import { X, Trash2, Save } from 'lucide-react'
import { useWorkflowStore, type WorkflowNode } from '@/stores/workflow-store'

export function NodeConfigPanel() {
  const { selectedNodeId, nodes, updateNode, removeNode, selectNode } = useWorkflowStore()
  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  
  const [formData, setFormData] = useState<Partial<WorkflowNode>>({})

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        name: selectedNode.name,
        agentName: selectedNode.agentName,
        config: selectedNode.config || {},
      })
    }
  }, [selectedNode])

  if (!selectedNode) {
    return (
      <div
        className="w-80 border-l flex flex-col items-center justify-center p-6"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <p
          className="text-sm text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          点击节点查看配置
        </p>
      </div>
    )
  }

  const handleSave = () => {
    updateNode(selectedNode.id, {
      name: formData.name || selectedNode.name,
      agentName: formData.agentName,
      config: formData.config || {},
    })
  }

  const handleDelete = () => {
    removeNode(selectedNode.id)
    selectNode(null)
  }

  const getNodeTypeLabel = () => {
    const labels: Record<string, string> = {
      agent: '智能体节点',
      human_in_loop: '人工审核节点',
      parallel: '并行执行节点',
      conditional: '条件判断节点',
      loop: '循环节点',
    }
    return labels[selectedNode.type] || '节点'
  }

  const getNodeTypeColor = () => {
    const colors: Record<string, string> = {
      agent: 'var(--color-accent)',
      human_in_loop: 'var(--color-status-pending)',
      parallel: 'var(--color-status-done)',
      conditional: 'var(--color-status-running)',
      loop: 'var(--color-emphasis)',
    }
    return colors[selectedNode.type] || 'var(--color-text-muted)'
  }

  return (
    <div
      className="w-80 border-l flex flex-col"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* 头部 */}
      <div
        className="flex items-center justify-between p-4 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: getNodeTypeColor() }}
          />
          <h3
            className="font-semibold text-sm"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {getNodeTypeLabel()}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={handleDelete}
            title="删除节点"
          >
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => selectNode(null)}
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 配置表单 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 节点名称 */}
        <div className="space-y-2">
          <label
            className="block text-sm font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            节点名称
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border rounded-md text-sm"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
            }}
            value={formData.name || ''}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="输入节点名称"
          />
        </div>

        {/* 智能体配置 */}
        {selectedNode.type === 'agent' && (
          <div className="space-y-2">
            <label
              className="block text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              智能体名称
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-md text-sm"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
              value={formData.agentName || ''}
              onChange={(e) => setFormData({ ...formData, agentName: e.target.value })}
              placeholder="输入智能体名称"
            />
          </div>
        )}

        {/* 条件表达式 */}
        {selectedNode.type === 'conditional' && (
          <div className="space-y-2">
            <label
              className="block text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              条件表达式
            </label>
            <textarea
              className="w-full px-3 py-2 border rounded-md text-sm"
              style={{
                borderColor: 'var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
              }}
              value={(formData.config?.condition as string) || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, condition: e.target.value },
                })
              }
              placeholder="例如: context.step1_result === 'success'"
              rows={3}
            />
          </div>
        )}

        {/* 循环配置 */}
        {selectedNode.type === 'loop' && (
          <>
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                最大迭代次数
              </label>
              <input
                type="number"
                className="w-full px-3 py-2 border rounded-md text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                }}
                value={(formData.config?.maxIterations as number) || 10}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, maxIterations: parseInt(e.target.value) || 10 },
                  })
                }
                min={1}
                max={100}
              />
            </div>
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                循环条件
              </label>
              <textarea
                className="w-full px-3 py-2 border rounded-md text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                }}
                value={(formData.config?.condition as string) || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    config: { ...formData.config, condition: e.target.value },
                  })
                }
                placeholder="继续循环的条件"
                rows={2}
              />
            </div>
          </>
        )}

        {/* 通知配置 */}
        <div className="space-y-2">
          <label
            className="block text-sm font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            通知设置
          </label>
          <div className="flex items-center justify-between">
            <span
              className="text-sm"
              style={{ color: 'var(--color-text-primary)' }}
            >
              完成时通知
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              checked={(formData.config?.notify as boolean) || false}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  config: { ...formData.config, notify: e.target.checked },
                })
              }
            />
          </div>
        </div>

        {/* 节点ID（只读） */}
        <div className="space-y-2">
          <label
            className="block text-sm font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            节点ID
          </label>
          <div
            className="text-xs p-2 rounded font-mono"
            style={{
              background: 'var(--color-surface-elevated)',
              color: 'var(--color-text-muted)',
            }}
          >
            {selectedNode.id}
          </div>
        </div>
      </div>

      {/* 底部按钮 */}
      <div
        className="p-4 border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={handleSave}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium"
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-text-inverse)',
          }}
        >
          <Save className="w-4 h-4" />
          保存配置
        </button>
      </div>
    </div>
  )
}
