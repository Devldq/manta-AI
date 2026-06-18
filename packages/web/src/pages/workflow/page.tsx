/* 工作流页 — /workflow */
import { useState, useEffect } from 'react'
import { Workflow, Plus, Search, Play, Pause, Settings, Trash2, Clock, CheckCircle, AlertCircle } from 'lucide-react'

interface WorkflowItem {
  id: string
  name: string
  description: string
  status: 'running' | 'paused' | 'completed' | 'error'
  lastRun: string
  nextRun: string
}

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    // 模拟从 API 获取工作流列表
    setTimeout(() => {
      setWorkflows([
        {
          id: '1',
          name: 'Data Processing Pipeline',
          description: 'Process and analyze incoming data',
          status: 'running',
          lastRun: '2 hours ago',
          nextRun: 'In 1 hour'
        },
        {
          id: '2',
          name: 'Report Generator',
          description: 'Generate weekly reports automatically',
          status: 'paused',
          lastRun: '1 day ago',
          nextRun: 'Paused'
        },
        {
          id: '3',
          name: 'Backup Scheduler',
          description: 'Schedule and manage backups',
          status: 'completed',
          lastRun: '3 hours ago',
          nextRun: 'In 4 hours'
        }
      ])
      setLoading(false)
    }, 1000)
  }, [])

  const filteredWorkflows = workflows.filter(wf =>
    wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wf.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getStatusIcon = (status: WorkflowItem['status']) => {
    switch (status) {
      case 'running':
        return <Play size={16} className="text-green-500" />
      case 'paused':
        return <Pause size={16} className="text-yellow-500" />
      case 'completed':
        return <CheckCircle size={16} className="text-blue-500" />
      case 'error':
        return <AlertCircle size={16} className="text-red-500" />
    }
  }

  const getStatusColor = (status: WorkflowItem['status']) => {
    switch (status) {
      case 'running':
        return 'bg-green-100 text-green-800'
      case 'paused':
        return 'bg-yellow-100 text-yellow-800'
      case 'completed':
        return 'bg-blue-100 text-blue-800'
      case 'error':
        return 'bg-red-100 text-red-800'
    }
  }

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-6xl mx-auto">
        {/* 顶部操作栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Workflows</h1>
            <p className="text-text-secondary mt-1">Automate your tasks and processes</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg transition-colors">
            <Plus size={18} />
            <span>New Workflow</span>
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted" size={18} />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface-elevated rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>

        {/* 工作流列表 */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className="bg-surface-elevated rounded-lg p-4 border border-border hover:border-accent transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
                      <Workflow size={20} className="text-text-inverse" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary">{workflow.name}</h3>
                      <p className="text-sm text-text-secondary">{workflow.description}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${getStatusColor(workflow.status)}`}>
                        {getStatusIcon(workflow.status)}
                        {workflow.status}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-text-muted">
                      <Clock size={14} />
                      <span>Last: {workflow.lastRun}</span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-sm text-text-muted">
                      <Clock size={14} />
                      <span>Next: {workflow.nextRun}</span>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Run">
                        <Play size={14} className="text-accent" />
                      </button>
                      <button className="p-1.5 hover:bg-surface rounded-md transition-colors" title="Pause">
                        <Pause size={14} className="text-text-muted" />
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
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!loading && filteredWorkflows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Workflow size={48} className="text-text-muted mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">No workflows found</h3>
            <p className="text-text-secondary">
              {searchQuery ? 'Try adjusting your search query' : 'Create your first workflow to get started'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
