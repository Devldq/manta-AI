/* AI start: 工作流可视化编排画布组件 */
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { WorkflowConfig, WorkflowStep } from '@/lib/types'
import { computeLayout, bezierPath } from './workflowLayout'
import type { NodePosition } from './workflowLayout'

// AI: 节点类型颜色映射
const NODE_TYPE_COLOR: Record<string, string> = {
  agent: '#3b82f6',
  human_in_loop: '#f59e0b',
  parallel: '#8b5cf6',
  default: '#4a5568',
}

// AI: 节点类型图标
const NODE_TYPE_ICON: Record<string, string> = {
  agent: '🤖',
  human_in_loop: '👤',
  parallel: '⟁',
}

interface Edge {
  id: string
  from: string
  to: string
  label?: string
  color?: string
  dashed?: boolean
}

interface CanvasNode extends NodePosition {
  step?: WorkflowStep
  branchOf?: string   // AI: 如果是 parallel 的 branch，指向父步骤 ID
  branchIndex?: number
  label: string
  type: string
  agent?: string
}

interface WorkflowCanvasProps {
  workflow: WorkflowConfig
  selectedNodeId: string | null
  onSelectNode: (stepId: string | null) => void
  onUpdateWorkflow: (wf: WorkflowConfig) => void
}

export default function WorkflowCanvas({
  workflow,
  selectedNodeId,
  onSelectNode,
  onUpdateWorkflow,
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 800 })
  const dragging = useRef<{ id: string; ox: number; oy: number; mx: number; my: number } | null>(null)

  // AI: 构建画布节点列表（包含 parallel branch 虚拟节点）
  const nodes: CanvasNode[] = []
  const edges: Edge[] = []

  const layout = computeLayout(workflow.steps || [])

  // AI: 初始化位置 Map（仅首次加载时）
  useEffect(() => {
    const map = new Map<string, { x: number; y: number }>()
    layout.forEach(n => {
      if (!map.has(n.id)) map.set(n.id, { x: n.x, y: n.y })
    })
    setPositions(map)
    // AI: 计算画布高度
    const maxY = Math.max(...layout.map(n => n.y + n.height), 600)
    setCanvasSize({ w: 900, h: maxY + 120 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id])

  // AI: 构建节点列表
  for (const step of (workflow.steps || [])) {
    const pos = positions.get(step.id) ?? layout.find(n => n.id === step.id) ?? { x: 200, y: 60, width: 220, height: 80 }
    let nodeType = step.type ?? (step.parallel ? 'parallel' : 'agent')

    nodes.push({
      id: step.id,
      x: pos.x,
      y: pos.y,
      width: 220,
      height: 80,
      stepIndex: 0,
      step,
      label: step.name,
      type: nodeType,
      agent: step.agent,
    })

    // AI: parallel 的每个 branch 作为子节点
    if (step.parallel && step.branches) {
      for (let bi = 0; bi < step.branches.length; bi++) {
        const bId = `${step.id}__branch_${bi}`
        const bPos = positions.get(bId) ?? layout.find(n => n.id === bId) ?? { x: 200 + bi * 280, y: pos.y + 140, width: 220, height: 80 }
        nodes.push({
          id: bId,
          x: bPos.x,
          y: bPos.y,
          width: 220,
          height: 80,
          stepIndex: 0,
          label: step.branches[bi].name,
          type: 'agent',
          agent: step.branches[bi].agent,
          branchOf: step.id,
          branchIndex: bi,
        })
        // AI: parallel → branch 连线
        edges.push({
          id: `${step.id}->${bId}`,
          from: step.id,
          to: bId,
          color: '#8b5cf6',
          dashed: true,
        })
        // AI: branch → after_all 连线
        if (step.after_all) {
          edges.push({
            id: `${bId}->${step.after_all}`,
            from: bId,
            to: step.after_all,
            color: '#8b5cf6',
            dashed: true,
          })
        }
      }
    }

    // AI: 普通 next 连线
    if (step.next) {
      edges.push({ id: `${step.id}->${step.next}`, from: step.id, to: step.next, color: '#4a90d9' })
    }

    // AI: human_in_loop actions 连线
    if (step.actions) {
      for (const [action, target] of Object.entries(step.actions)) {
        const isApprove = action === 'approve' || action === 'score'
        edges.push({
          id: `${step.id}->${action}->${target}`,
          from: step.id,
          to: target,
          label: action,
          color: isApprove ? '#68d391' : '#fc8181',
          dashed: !isApprove,
        })
      }
    }
  }

  // AI: 鼠标按下开始拖拽
  const handleMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    onSelectNode(nodeId.includes('__branch_') ? nodeId.split('__branch_')[0] : nodeId)
    const pos = positions.get(nodeId) ?? { x: 0, y: 0 }
    dragging.current = { id: nodeId, ox: pos.x, oy: pos.y, mx: e.clientX, my: e.clientY }
  }, [positions, onSelectNode])

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const { id, ox, oy, mx, my } = dragging.current
      const dx = e.clientX - mx
      const dy = e.clientY - my
      setPositions(prev => {
        const next = new Map(prev)
        next.set(id, { x: Math.max(0, ox + dx), y: Math.max(0, oy + dy) })
        return next
      })
    }
    const handleUp = () => { dragging.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  // AI: 点击画布空白处取消选中
  const handleCanvasClick = () => onSelectNode(null)

  // AI: 获取节点中心点（底部/顶部）用于连线
  const getNodeBottom = (id: string) => {
    const n = nodes.find(n => n.id === id)
    if (!n) return { x: 0, y: 0 }
    return { x: n.x + n.width / 2, y: n.y + n.height }
  }
  const getNodeTop = (id: string) => {
    const n = nodes.find(n => n.id === id)
    if (!n) return { x: 0, y: 0 }
    return { x: n.x + n.width / 2, y: n.y }
  }

  // AI: 添加新步骤到工作流
  const handleAddStep = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newId = `step_${Date.now()}`
    const updated: WorkflowConfig = {
      ...workflow,
      steps: [
        ...(workflow.steps || []),
        { id: newId, name: '新步骤', agent: 'dev' },
      ],
    }
    onUpdateWorkflow(updated)
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-auto"
      style={{ background: '#0a0c13', flex: 1, minHeight: 0 }}
      onClick={handleCanvasClick}
    >
      {/* AI: 背景网格 */}
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: canvasSize.w, height: canvasSize.h, pointerEvents: 'none' }}
      >
        <defs>
          <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1a1d2e" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* AI: 连线 SVG 层 */}
      <svg
        style={{ position: 'absolute', top: 0, left: 0, width: canvasSize.w, height: canvasSize.h, pointerEvents: 'none' }}
      >
        {edges.map(edge => {
          const src = getNodeBottom(edge.from)
          const dst = getNodeTop(edge.to)
          if (!src || !dst) return null
          const d = bezierPath(src.x, src.y, dst.x, dst.y)
          const midX = (src.x + dst.x) / 2
          const midY = (src.y + dst.y) / 2
          return (
            <g key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke={edge.color ?? '#4a90d9'}
                strokeWidth={2}
                strokeDasharray={edge.dashed ? '5,4' : undefined}
                opacity={0.8}
              />
              {/* AI: 箭头 */}
              <polygon
                points={`${dst.x},${dst.y} ${dst.x - 5},${dst.y - 8} ${dst.x + 5},${dst.y - 8}`}
                fill={edge.color ?? '#4a90d9'}
                opacity={0.9}
              />
              {/* AI: 连线标签 */}
              {edge.label && (
                <text x={midX} y={midY - 4} textAnchor="middle" fontSize={10} fill={edge.color ?? '#a0aec0'}>
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* AI: 节点层 */}
      <div style={{ position: 'relative', width: canvasSize.w, height: canvasSize.h }}>
        {nodes.map(node => {
          const isSelected = selectedNodeId === node.id || (node.branchOf && selectedNodeId === node.branchOf)
          const color = NODE_TYPE_COLOR[node.type] ?? NODE_TYPE_COLOR.default
          const icon = NODE_TYPE_ICON[node.type] ?? '📦'

          return (
            <div
              key={node.id}
              onMouseDown={e => handleMouseDown(e, node.id)}
              onClick={e => { e.stopPropagation(); onSelectNode(node.branchOf ?? node.id) }}
              style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                width: node.width,
                cursor: 'grab',
                userSelect: 'none',
                zIndex: isSelected ? 10 : 1,
              }}
            >
              <div
                style={{
                  background: '#1a1d2e',
                  border: `2px solid ${isSelected ? color : '#2d3148'}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  boxShadow: isSelected ? `0 0 0 3px ${color}33` : '0 2px 8px rgba(0,0,0,0.4)',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
              >
                {/* AI: 节点类型色条 */}
                <div style={{
                  position: 'absolute', top: 0, left: 12, right: 12, height: 3,
                  background: color, borderRadius: '0 0 3px 3px'
                }} />
                {/* AI: 节点标题行 */}
                <div className="flex items-center gap-2 mt-1">
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span className="text-xs font-semibold text-white truncate flex-1">{node.label}</span>
                </div>
                {/* AI: agent 标签 */}
                {node.agent && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `${color}22`, color: color, border: `1px solid ${color}44` }}>
                      {node.agent}
                    </span>
                  </div>
                )}
                {/* AI: 步骤 ID */}
                <div className="mt-1 text-xs" style={{ color: '#4a5568' }}>
                  #{node.branchOf ? `${node.branchOf}[${node.branchIndex}]` : node.id}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* AI: 添加步骤按钮（悬浮在右下角） */}
      <button
        onClick={handleAddStep}
        className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white"
        style={{ background: '#3b82f6', boxShadow: '0 2px 8px rgba(59,130,246,0.4)', zIndex: 20 }}
      >
        ＋ 添加步骤
      </button>
    </div>
  )
}
/* AI end: 工作流可视化编排画布组件 */
