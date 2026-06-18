/* 应用管理页 — /apps */
import { useState, useEffect } from 'react'
import { AppWindow, Plus, Search, MoreVertical, Play, Settings, Trash2 } from 'lucide-react'

interface App {
  id: string
  name: string
  description: string
  status: 'active' | 'inactive' | 'error'
  lastUpdated: string
}

export default function AppsPage() {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    // 模拟从 API 获取应用列表
    setTimeout(() => {
      setApps([
        {
          id: '1',
          name: 'Data Analyzer',
          description: 'Analyze data with AI-powered insights',
          status: 'active',
          lastUpdated: '2 hours ago'
        },
        {
          id: '2',
          name: 'Code Assistant',
          description: 'AI-powered code generation and review',
          status: 'active',
          lastUpdated: '1 day ago'
        },
        {
          id: '3',
          name: 'Document Generator',
          description: 'Generate documents from templates',
          status: 'inactive',
          lastUpdated: '3 days ago'
        }
      ])
      setLoading(false)
    }, 1000)
  }, [])

  const filteredApps = apps.filter(app =>
    app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    app.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-6xl mx-auto">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Applications</h1>
            <p className="text-text-secondary mt-1">Manage your AI applications</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg transition-colors">
            <Plus size={18} />
            <span>New App</span>
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" size={18} />
            <input
              type="text"
              placeholder="Search applications..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface-elevated rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* 应用列表 */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredApps.map((app) => (
              <div
                key={app.id}
                className="bg-surface-elevated rounded-lg p-4 border border-border hover:border-accent transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
                      <AppWindow size={20} className="text-text-inverse" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary">{app.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        app.status === 'active' ? 'bg-green-100 text-green-800' :
                        app.status === 'inactive' ? 'bg-gray-100 text-gray-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {app.status}
                      </span>
                    </div>
                  </div>
                  <button className="p-1 hover:bg-surface rounded-md transition-colors">
                    <MoreVertical size={16} className="text-text-muted" />
                  </button>
                </div>
                
                <p className="text-text-secondary text-sm mb-4">{app.description}</p>
                
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">Updated {app.lastUpdated}</span>
                  <div className="flex items-center gap-2">
                    <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Run">
                      <Play size={14} className="text-accent" />
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
        {!loading && filteredApps.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <AppWindow size={48} className="text-text-muted mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">No applications found</h3>
            <p className="text-text-secondary">
              {searchQuery ? 'Try adjusting your search query' : 'Create your first application to get started'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
