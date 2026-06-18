/* 节点面板组件 */
import { useState } from 'react'
import { Search, Plus, Zap, GitBranch, Clock, Database, Globe, Code } from 'lucide-react'

interface NodeType {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  category: 'action' | 'condition' | 'trigger' | 'data'
}

export function NodePalette() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const nodeTypes: NodeType[] = [
    { id: 'start', name: 'Start', description: 'Begin workflow', icon: <Zap size={16} />, category: 'trigger' },
    { id: 'end', name: 'End', description: 'End workflow', icon: <Zap size={16} />, category: 'trigger' },
    { id: 'action', name: 'Action', description: 'Execute action', icon: <Code size={16} />, category: 'action' },
    { id: 'condition', name: 'Condition', description: 'Branch based on condition', icon: <GitBranch size={16} />, category: 'condition' },
    { id: 'delay', name: 'Delay', description: 'Wait for duration', icon: <Clock size={16} />, category: 'action' },
    { id: 'http', name: 'HTTP Request', description: 'Make HTTP call', icon: <Globe size={16} />, category: 'action' },
    { id: 'database', name: 'Database', description: 'Query database', icon: <Database size={16} />, category: 'data' },
    { id: 'code', name: 'Code', description: 'Run custom code', icon: <Code size={16} />, category: 'action' },
  ]

  const categories = [
    { id: 'trigger', label: 'Triggers' },
    { id: 'action', label: 'Actions' },
    { id: 'condition', label: 'Conditions' },
    { id: 'data', label: 'Data' },
  ]

  const filteredNodes = nodeTypes.filter(node => {
    const matchesSearch = node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         node.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = !selectedCategory || node.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="w-64 h-full flex flex-col bg-surface border-r border-border">
      {/* 头部 */}
      <div className="p-3 border-b border-border-subtle">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Node Palette</h3>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-text-muted" size={14} />
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              !selectedCategory ? 'bg-accent text-text-inverse' : 'bg-surface-elevated text-text-secondary hover:bg-surface'
            }`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                selectedCategory === category.id ? 'bg-accent text-text-inverse' : 'bg-surface-elevated text-text-secondary hover:bg-surface'
              }`}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      {/* 节点列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {filteredNodes.map((node) => (
          <div
            key={node.id}
            className="flex items-center gap-3 p-2 rounded-md hover:bg-surface-elevated cursor-pointer transition-colors"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('nodeType', node.id)
            }}
          >
            <div className="p-1.5 bg-surface rounded-md">
              {node.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{node.name}</p>
              <p className="text-xs text-text-muted truncate">{node.description}</p>
            </div>
            <Plus size={14} className="text-text-muted" />
          </div>
        ))}

        {filteredNodes.length === 0 && (
          <div className="px-2 py-4 text-center text-text-muted text-sm">
            No nodes found
          </div>
        )}
      </div>
    </div>
  )
}
