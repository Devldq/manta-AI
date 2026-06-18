/* 工作空间配置组件 */
import { useState, useEffect } from 'react'
import { Save, X, FolderOpen, Settings, Plus, Trash2 } from 'lucide-react'

interface WorkspaceConfigProps {
  workspaceId?: string
  onClose: () => void
  onSave: (config: any) => void
}

interface WorkspaceSettings {
  name: string
  description: string
  rootPath: string
  autoLoad: boolean
  plugins: string[]
}

export function WorkspaceConfig({ workspaceId, onClose, onSave }: WorkspaceConfigProps) {
  const [settings, setSettings] = useState<WorkspaceSettings>({
    name: '',
    description: '',
    rootPath: '',
    autoLoad: true,
    plugins: []
  })
  const [loading, setLoading] = useState(false)
  const [newPlugin, setNewPlugin] = useState('')

  useEffect(() => {
    if (workspaceId) {
      // 从 API 获取工作空间配置
      fetch(`/api/workspaces/${workspaceId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            const ws = data.data.workspace
            setSettings({
              name: ws.name,
              description: ws.description || '',
              rootPath: ws.rootPath || '',
              autoLoad: ws.autoLoad ?? true,
              plugins: ws.plugins || []
            })
          }
        })
    }
  }, [workspaceId])

  const handleSave = async () => {
    setLoading(true)
    try {
      const url = workspaceId ? `/api/workspaces/${workspaceId}` : '/api/workspaces'
      const method = workspaceId ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      const data = await res.json()
      if (data.success) {
        onSave(data.data.workspace)
      }
    } finally {
      setLoading(false)
    }
  }

  const addPlugin = () => {
    if (newPlugin.trim() && !settings.plugins.includes(newPlugin.trim())) {
      setSettings(prev => ({
        ...prev,
        plugins: [...prev.plugins, newPlugin.trim()]
      }))
      setNewPlugin('')
    }
  }

  const removePlugin = (plugin: string) => {
    setSettings(prev => ({
      ...prev,
      plugins: prev.plugins.filter(p => p !== plugin)
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[80vh] bg-surface rounded-lg shadow-xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold">
            {workspaceId ? 'Edit Workspace' : 'New Workspace'}
          </h2>
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
              Name
            </label>
            <input
              type="text"
              value={settings.name}
              onChange={(e) => setSettings(prev => ({ ...prev, name: e.target.value }))}
              placeholder="My Workspace"
              className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Description
            </label>
            <textarea
              value={settings.description}
              onChange={(e) => setSettings(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Workspace description..."
              rows={3}
              className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Root Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={settings.rootPath}
                onChange={(e) => setSettings(prev => ({ ...prev, rootPath: e.target.value }))}
                placeholder="/path/to/project"
                className="flex-1 px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button className="px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors">
                <FolderOpen size={16} />
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoLoad}
                onChange={(e) => setSettings(prev => ({ ...prev, autoLoad: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-text-secondary">Auto-load on startup</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Plugins
            </label>
            <div className="space-y-2">
              {settings.plugins.map((plugin) => (
                <div key={plugin} className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md">
                  <span className="flex-1 text-sm">{plugin}</span>
                  <button
                    onClick={() => removePlugin(plugin)}
                    className="p-1 hover:bg-surface rounded"
                  >
                    <Trash2 size={14} className="text-text-muted" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPlugin}
                  onChange={(e) => setNewPlugin(e.target.value)}
                  placeholder="Add plugin..."
                  className="flex-1 px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                  onKeyPress={(e) => e.key === 'Enter' && addPlugin()}
                />
                <button
                  onClick={addPlugin}
                  className="px-3 py-2 bg-accent hover:bg-accent-hover rounded-md text-sm transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:bg-surface-elevated rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !settings.name.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
