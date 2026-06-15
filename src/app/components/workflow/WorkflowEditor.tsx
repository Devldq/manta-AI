'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { 
  Bot, 
  User, 
  GitBranch, 
  Split, 
  RotateCw,
  GripVertical,
  Trash2,
  Link,
  Unlink
} from 'lucide-react'
import { useWorkflowStore, type WorkflowNode, type WorkflowEdge } from '@/stores/workflow-store'
import type { WorkflowStepType } from '@/core/types'

/** 节点颜色映射 */
const NODE_COLORS: Record<WorkflowStepType, string> = {
  agent: 'var(--color-accent)',
  human_in_loop: 'var(--color-status-pending)',
  parallel: 'var(--color-status-done)',
  conditional: 'var(--color-status-running)',
  loop: 'var(--color-emphasis)',
}

/** 节点图标映射 */
const NODE_ICONS: Record<WorkflowStepType, React.ReactNode> = {
  agent: <Bot className="w-4 h-4" />,
  human_in_loop: <User className="w-4 h-4" />,
  parallel: <Split className="w-4 h-4" />,
  conditional: <GitBranch className="w-4 h-4" />,
  loop: <RotateCw className="w-4 h-4" />,
}

interface WorkflowEditorProps {
  className?: string
}

export function WorkflowEditor({ className }: WorkflowEditorProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const {
    nodes,
    edges,
    selectedNodeId,
    selectNode,
    moveNode,
    removeNode,
    addNode,
    addEdge,
    removeEdge,
  } = useWorkflowStore()

  const [dragging, setDragging] = useState<{
    nodeId: string
    offsetX: number
    offsetY: number
  } | null>(null)

  const [connecting, setConnecting] = useState<{
    sourceId: string
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)

  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // 处理拖拽节点开始
  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      setDragging({
        nodeId,
        offsetX: e.clientX - rect.left - node.position.x + canvasOffset.x,
        offsetY: e.clientY - rect.top - node.position.y + canvasOffset.y,
      })
      selectNode(nodeId)
    },
    [nodes, canvasOffset, selectNode]
  )

  // 处理连接开始
  const handleConnectionStart = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.stopPropagation()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      setConnecting({
        sourceId: nodeId,
        startX: node.position.x + 120 + canvasOffset.x, // 节点右侧
        startY: node.position.y + 30 + canvasOffset.y, // 节点中心
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      })
    },
    [nodes, canvasOffset]
  )

  // 处理鼠标移动
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      // 拖拽节点
      if (dragging) {
        const x = e.clientX - rect.left - dragging.offsetX + canvasOffset.x
        const y = e.clientY - rect.top - dragging.offsetY + canvasOffset.y
        moveNode(dragging.nodeId, { x: Math.max(0, x), y: Math.max(0, y) })
      }

      // 连接线
      if (connecting) {
        setConnecting((prev) =>
          prev
            ? {
                ...prev,
                currentX: e.clientX - rect.left,
                currentY: e.clientY - rect.top,
              }
            : null
        )
      }

      // 平移画布
      if (isPanning) {
        const dx = e.clientX - panStart.x
        const dy = e.clientY - panStart.y
        setCanvasOffset((prev) => ({
          x: prev.x + dx,
          y: prev.y + dy,
        }))
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      // 结束拖拽
      if (dragging) {
        setDragging(null)
      }

      // 结束连接
      if (connecting) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const mouseX = e.clientX - rect.left + canvasOffset.x
          const mouseY = e.clientY - rect.top + canvasOffset.y

          // 查找目标节点
          const targetNode = nodes.find(
            (n) =>
              n.id !== connecting.sourceId &&
              mouseX >= n.position.x &&
              mouseX <= n.position.x + 240 &&
              mouseY >= n.position.y &&
              mouseY <= n.position.y + 60
          )

          if (targetNode) {
            addEdge(connecting.sourceId, targetNode.id)
          }
        }
        setConnecting(null)
      }

      // 结束平移
      if (isPanning) {
        setIsPanning(false)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    dragging,
    connecting,
    isPanning,
    panStart,
    canvasOffset,
    nodes,
    moveNode,
    addEdge,
  ])

  // 处理画布点击（开始平移）
  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current) {
        // 点击空白区域取消选择
        selectNode(null)
        
        // 开始平移
        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    },
    [selectNode]
  )

  // 处理放置节点
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const nodeType = e.dataTransfer.getData('nodeType') as WorkflowStepType
      if (!nodeType) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const x = e.clientX - rect.left - 60 + canvasOffset.x
      const y = e.clientY - rect.top - 30 + canvasOffset.y

      addNode(nodeType, { x: Math.max(0, x), y: Math.max(0, y) })
    },
    [canvasOffset, addNode]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // 渲染连接线
  const renderEdges = () => {
    return edges.map((edge) => {
      const source = nodes.find((n) => n.id === edge.source)
      const target = nodes.find((n) => n.id === edge.target)
      if (!source || !target) return null

      const x1 = source.position.x + 120 - canvasOffset.x // 节点右侧
      const y1 = source.position.y + 30 - canvasOffset.y // 节点中心
      const x2 = target.position.x - canvasOffset.x // 节点左侧
      const y2 = target.position.y + 30 - canvasOffset.y // 节点中心

      // 计算贝塞尔曲线控制点
      const cx1 = x1 + 50
      const cx2 = x2 - 50

      return (
        <g key={edge.id}>
          {/* 连接线 */}
          <path
            d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          {/* 删除按钮 */}
          <g
            transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2})`}
            className="cursor-pointer opacity-0 hover:opacity-100 transition-opacity"
            onClick={() => removeEdge(edge.id)}
          >
            <circle r={10} fill="var(--color-surface)" stroke="var(--color-border)" />
            <Trash2 className="w-3 h-3" style={{ color: 'var(--color-text-muted)' }} />
          </g>
        </g>
      )
    })
  }

  // 渲染正在创建的连接线
  const renderConnectingLine = () => {
    if (!connecting) return null

    const source = nodes.find((n) => n.id === connecting.sourceId)
    if (!source) return null

    const x1 = source.position.x + 120 - canvasOffset.x
    const y1 = source.position.y + 30 - canvasOffset.y
    const x2 = connecting.currentX
    const y2 = connecting.currentY

    const cx1 = x1 + 50
    const cx2 = x2 - 50

    return (
      <path
        d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeDasharray="6 4"
        opacity={0.6}
      />
    )
  }

  // 渲染节点
  const renderNodes = () => {
    return nodes.map((node) => {
      const isSelected = selectedNodeId === node.id
      const color = NODE_COLORS[node.type]
      const icon = NODE_ICONS[node.type]

      return (
        <div
          key={node.id}
          className="absolute select-none"
          style={{
            left: node.position.x - canvasOffset.x,
            top: node.position.y - canvasOffset.y,
            width: 240,
          }}
        >
          {/* 节点主体 */}
          <div
            className={`
              rounded-lg border-2 cursor-move transition-all
              ${isSelected ? 'ring-2 ring-offset-2' : ''}
            `}
            style={{
              borderColor: color,
              background: 'var(--color-surface)',
              boxShadow: isSelected
                ? `0 0 0 2px var(--color-background), 0 0 0 4px ${color}`
                : 'var(--shadow-sm)',
            }}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          >
            {/* 头部 */}
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-t-md"
              style={{ background: `${color}20` }}
            >
              <div style={{ color }}>{icon}</div>
              <span
                className="text-sm font-medium flex-1 truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {node.name}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  removeNode(node.id)
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* 内容 */}
            <div className="px-3 py-2">
              {node.agentName && (
                <div
                  className="text-xs truncate"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Agent: {node.agentName}
                </div>
              )}
            </div>

            {/* 连接点 */}
            {/* 入点（左侧） */}
            <div
              className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 cursor-pointer hover:scale-150 transition-transform"
              style={{
                borderColor: color,
                background: 'var(--color-surface)',
              }}
            />
            {/* 出点（右侧） */}
            <div
              className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 cursor-pointer hover:scale-150 transition-transform"
              style={{
                borderColor: color,
                background: color,
              }}
              onMouseDown={(e) => handleConnectionStart(e, node.id)}
            />
          </div>
        </div>
      )
    })
  }

  return (
    <div
      ref={canvasRef}
      className={`relative overflow-hidden ${className || ''}`}
      style={{
        background: 'var(--color-background)',
        backgroundImage:
          'radial-gradient(circle, var(--color-border-subtle) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
      onMouseDown={handleCanvasMouseDown}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* 连接线层 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {renderEdges()}
        {renderConnectingLine()}
      </svg>

      {/* 节点层 */}
      {renderNodes()}

      {/* 空状态提示 */}
      {nodes.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <div className="text-center">
            <p className="text-lg mb-2">拖拽节点到此处开始创建工作流</p>
            <p className="text-sm">从左侧面板选择节点类型</p>
          </div>
        </div>
      )}
    </div>
  )
}
