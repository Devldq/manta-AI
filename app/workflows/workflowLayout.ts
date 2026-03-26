/* AI start: 工作流节点布局算法 */
import type { WorkflowStep } from '@/lib/types'

export interface NodePosition {
  id: string
  x: number
  y: number
  width: number
  height: number
  stepIndex: number
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 80
const H_GAP = 60   // AI: 水平间距（parallel 分支）
const V_GAP = 80   // AI: 垂直间距

// AI: 根据工作流步骤列表计算初始节点位置（自动布局）
export function computeLayout(steps: WorkflowStep[]): NodePosition[] {
  const positions: NodePosition[] = []
  const centerX = 400
  let y = 60

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    if (step.parallel && step.branches && step.branches.length > 0) {
      // AI: parallel 节点 — 父节点居中，子 branch 横向展开
      const branchCount = step.branches.length
      const totalWidth = branchCount * NODE_WIDTH + (branchCount - 1) * H_GAP
      const startX = centerX - totalWidth / 2

      // AI: 添加 parallel 容器节点（较宽）
      positions.push({
        id: step.id,
        x: centerX - NODE_WIDTH / 2,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        stepIndex: i,
      })
      y += NODE_HEIGHT + 50

      // AI: 添加各分支子节点
      for (let b = 0; b < step.branches.length; b++) {
        const branch = step.branches[b]
        const branchId = `${step.id}__branch_${b}`
        positions.push({
          id: branchId,
          x: startX + b * (NODE_WIDTH + H_GAP),
          y,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          stepIndex: i,
        })
        void branch
      }
      y += NODE_HEIGHT + V_GAP
    } else {
      // AI: 普通节点，居中放置
      positions.push({
        id: step.id,
        x: centerX - NODE_WIDTH / 2,
        y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        stepIndex: i,
      })
      y += NODE_HEIGHT + V_GAP
    }
  }

  return positions
}

// AI: 计算贝塞尔曲线控制点（从 source 节点底部到 target 节点顶部）
export interface BezierPoint {
  x: number
  y: number
}

export function bezierPath(
  sx: number, sy: number,  // AI: 起点
  ex: number, ey: number,  // AI: 终点
): string {
  const midY = (sy + ey) / 2
  return `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`
}
/* AI end: 工作流节点布局算法 */
