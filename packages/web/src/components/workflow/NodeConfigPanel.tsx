/* 节点配置面板组件 */
import { useState, useEffect } from 'react'
import { X, Save, Trash2 } from 'lucide-react'

interface NodeConfigPanelProps {
  nodeId: string
  nodeType: string
  nodeName: string
  onClose: () => void
  onSave: (config: any) => void
  onDelete: () => void
}

export function NodeConfigPanel({
  nodeId,
  nodeType,
  nodeName,
  onClose,
  onSave,
  onDelete
}: NodeConfigPanelProps) {
  const [name, setName] = useState(nodeName)
  const [config, setConfig] = useState<Record<string, any>>({})

  useEffect(() => {
    // 根据节点类型加载默认配置
    const defaultConfigs: Record<string, Record<string, any>> = {
      action: { actionType: 'custom', timeout: 30 },
      condition: { condition: '', trueBranch: '', falseBranch: '' },
      delay: { duration: 1000, unit: 'ms' },
      http: { method: 'GET', url: '', headers: {}, body: '' },
      database: { query: '', database: '' },
      code: { language: 'javascript', code: '' },
    }
    setConfig(defaultConfigs[nodeType] || {})
  }, [nodeType])

  const handleSave = () => {
    onSave({ nodeId, name, ...config })
  }

  const renderConfigFields = () => {
    switch (nodeType) {
      case 'action':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Action Type
              </label>
              <select
                value={config.actionType || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, actionType: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="custom">Custom</option>
                <option value="api">API Call</option>
                <option value="script">Script</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Timeout (seconds)
              </label>
              <input
                type="number"
                value={config.timeout || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, timeout: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </>
        )

      case 'condition':
        return (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Condition Expression
            </label>
            <textarea
              value={config.condition || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, condition: e.target.value }))}
              placeholder="e.g., data.status === 'success'"
              rows={3}
              className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )

      case 'delay':
        return (
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Duration
              </label>
              <input
                type="number"
                value={config.duration || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, duration: parseInt(e.target.value) }))}
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Unit
              </label>
              <select
                value={config.unit || 'ms'}
                onChange={(e) => setConfig(prev => ({ ...prev, unit: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="ms">Milliseconds</option>
                <option value="s">Seconds</option>
                <option value="m">Minutes</option>
                <option value="h">Hours</option>
              </select>
            </div>
          </div>
        )

      case 'http':
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Method
              </label>
              <select
                value={config.method || 'GET'}
                onChange={(e) => setConfig(prev => ({ ...prev, method: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                URL
              </label>
              <input
                type="text"
                value={config.url || ''}
                onChange={(e) => setConfig(prev => ({ ...prev, url: e.target.value }))}
                placeholder="https://api.example.com/endpoint"
                className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </>
        )

      case 'code':
        return (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Code
            </label>
            <textarea
              value={config.code || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, code: e.target.value }))}
              placeholder="Write your code here..."
              rows={10}
              className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )

      default:
        return (
          <p className="text-sm text-text-muted">
            No configuration available for this node type.
          </p>
        )
    }
  }

  return (
    <div className="w-80 h-full flex flex-col bg-surface border-l border-border-subtle">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <h3 className="text-lg font-semibold text-text-primary">Node Config</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-surface-elevated rounded-md transition-colors"
        >
          <X size={20} className="text-text-secondary" />
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Node Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Node Type
          </label>
          <div className="px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-muted">
            {nodeType}
          </div>
        </div>

        <div className="border-t border-border-subtle pt-4">
          <h4 className="text-sm font-medium text-text-primary mb-3">Configuration</h4>
          {renderConfigFields()}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between p-4 border-t border-border-subtle">
        <button
          onClick={onDelete}
          className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
        >
          <Trash2 size={16} />
          Delete
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-accent hover:bg-accent-hover rounded-md transition-colors"
        >
          <Save size={16} />
          Save
        </button>
      </div>
    </div>
  )
}
