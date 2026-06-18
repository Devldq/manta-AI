/* 工作流编辑器组件 */
import { useState, useCallback } from 'react'
import { Save, Play, Plus, Trash2 } from 'lucide-react'

interface WorkflowNode {
  id: string
  type: 'start' | 'action' | 'condition' | 'end'
  label: string
  x: number
  y: number
}

interface WorkflowEdge {
  id: string
  from: string
  to: string
}

export function WorkflowEditor() {
  const [nodes, setNodes] = useState<WorkflowNode[]>([
    { id: '1', type: 'start', label: 'Start', x: 100, y: 100 },
    { id: '2', type: 'end', label: 'End', x: 400, y: 100 }
  ])
  const [edges, setEdges] = useState<WorkflowEdge[]>([
    { id: 'e1', from: '1', to: '2' }
  ])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [workflowName, setWorkflowName] = useState('Untitled Workflow')

  const handleSave = () => {
    console.log('Saving workflow:', { name: workflowName, nodes, edges })
    // TODO: 调用 API 保存工作流
  }

  const handleRun = () => {
    console.log('Running workflow:', { name: workflowName, nodes, edges })
    // TODO: 执行工作流
  }

  const addNode = (type: WorkflowNode['type']) => {
    const newNode: WorkflowNode = {
      id: String(Date.now()),
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      x: 200 + Math.random() * 200,
      y: 200 + Math.random() * 200
    }
    setNodes(prev => [...prev, newNode])
  }

  const deleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id))
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id))
    if (selectedNode === id) {
      setSelectedNode(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-4">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="text-lg font-semibold bg-transparent border-none focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => addNode('action')}
            className="flex items-center gap-2 px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors"
          >
            <Plus size={16} />
            Add Action
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-3 py-2 bg-surface-elevated hover:bg-surface rounded-md text-sm transition-colors"
          >
            <Save size={16} />
            Save
          </button>
          <button
            onClick={handleRun}
            className="flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover rounded-md text-sm transition-colors"
          >
            <Play size={16} />
            Run
          </button>
        </div>
      </div>

      {/* 编辑器画布 */}
      <div className="flex-1 relative overflow-auto bg-background p-4">
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
          {edges.map((edge) => {
            const fromNode = nodes.find(n => n.id === edge.from)
            const toNode = nodes.find(n => n.id === edge.to)
            if (!fromNode || !toNode) return null

            return (
              <line
                key={edge.id}
                x1={fromNode.x + 50}
                y1={fromNode.y + 25}
                x2={toNode.x + 50}
                y2={toNode.y + 25}
                stroke="var(--color-border)"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
            )
          })}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-border)" />
            </marker>
          </defs>
        </svg>

        {nodes.map((node) => (
          <div
            key={node.id}
            className={`absolute w-[100px] h-[50px] rounded-md border-2 cursor-move flex items-center justify-center text-sm font-medium ${
              node.type === 'start' ? 'bg-green-500/20 border-green-500' :
              node.type === 'end' ? 'bg-red-500/20 border-red-500' :
              node.type === 'action' ? 'bg-blue-500/20 border-blue-500' :
              'bg-yellow-500/20 border-yellow-500'
            } ${selectedNode === node.id ? 'ring-2 ring-accent' : ''}`}
            style={{ left: node.x, top: node.y }}
            onClick={() => setSelectedNode(node.id)}
          >
            <span className="text-text-primary">{node.label}</span>
            {node.type !== 'start' && node.type !== 'end' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteNode(node.id)
                }}
                className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full opacity-0 hover:opacity-100 transition-opacity"
              >
                <Trash2 size={12} className="text-white" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 属性面板 */}
      {selectedNode && (
        <div className="w-64 border-l border-border-subtle p-4">
          <h3 className="font-semibold mb-4">Properties</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-text-muted">Label</label>
              <input
                type="text"
                value={nodes.find(n => n.id === selectedNode)?.label || ''}
                onChange={(e) => {
                  setNodes(prev => prev.map(n =>
                    n.id === selectedNode ? { ...n, label: e.target.value } : n
                  ))
                }}
                className="w-full mt-1 px-3 py-2 bg-surface-elevated rounded-md text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-text-muted">Type</label>
              <select
                value={nodes.find(n => n.id === selectedNode)?.type || ''}
                onChange={(e) => {
                  setNodes(prev => prev.map(n =>
                    n.id === selectedNode ? { ...n, type: e.target.value as WorkflowNode['type'] } : n
                  ))
                }}
                className="w-full mt-1 px-3 py-2 bg-surface-elevated rounded-md text-sm"
              >
                <option value="start">Start</option>
                <option value="action">Action</option>
                <option value="condition">Condition</option>
                <option value="end">End</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
