/* 工作空间页 — /workspace */
import { useState, useEffect } from 'react'
import { FolderOpen, Plus, Search, MoreVertical, Folder, File, Settings, Trash2 } from 'lucide-react'

interface Workspace {
  id: string
  name: string
  description: string
  items: number
  lastModified: string
}

export default function WorkspacePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    // 模拟从 API 获取工作空间列表
    setTimeout(() => {
      setWorkspaces([
        {
          id: '1',
          name: 'My Projects',
          description: 'Personal projects and experiments',
          items: 12,
          lastModified: '2 hours ago'
        },
        {
          id: '2',
          name: 'Work Documents',
          description: 'Work-related documents and files',
          items: 8,
          lastModified: '1 day ago'
        },
        {
          id: '3',
          name: 'Research Notes',
          description: 'Research materials and notes',
          items: 24,
          lastModified: '3 days ago'
        }
      ])
      setLoading(false)
    }, 1000)
  }, [])

  const filteredWorkspaces = workspaces.filter(ws =>
    ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ws.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-6xl mx-auto">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Workspaces</h1>
            <p className="text-text-secondary mt-1">Organize your files and projects</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg transition-colors">
            <Plus size={18} />
            <span>New Workspace</span>
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" size={18} />
            <input
              type="text"
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface-elevated rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* 工作空间列表 */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className="bg-surface-elevated rounded-lg p-4 border border-border hover:border-accent transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
                      <FolderOpen size={20} className="text-text-inverse" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary">{workspace.name}</h3>
                      <span className="text-xs text-text-muted">{workspace.items} items</span>
                    </div>
                  </div>
                  <button className="p-1 hover:bg-surface rounded-md transition-colors">
                    <MoreVertical size={16} className="text-text-muted" />
                  </button>
                </div>
                
                <p className="text-text-secondary text-sm mb-4">{workspace.description}</p>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Modified {workspace.lastModified}</span>
                  <div className="flex items-center gap-2">
                    <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Open">
                      <Folder size={14} className="text-accent" />
                    </button>
                    <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Settings">
                      <Settings size={14} className="text-text-muted" />
                    </button>
                    <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Delete">
                      <Trash2 size={14} className="text-text-muted" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!loading && filteredWorkspaces.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FolderOpen size={48} className="text-text-muted mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">No workspaces found</h3>
            <p className="text-text-secondary">
              {searchQuery ? 'Try adjusting your search query' : 'Create your first workspace to get started'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
