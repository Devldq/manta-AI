/* Workflow Zustand Store — 工作流状态管理 */

import { create } from 'zustand'
import type { WorkflowDef, WorkflowStep, WorkflowStepType } from '@/core/types'
import { swrFetch, invalidateCache } from '@/stores/lib/swr-fetch'

/** 可视化节点（前端扩展类型） */
export interface WorkflowNode {
  id: string
  type: WorkflowStepType
  name: string
  agentName?: string
  /** 节点在画布上的位置 */
  position: { x: number; y: number }
  /** 节点配置 */
  config: Record<string, unknown>
  /** 分支节点（parallel/conditional） */
  branches?: WorkflowNode[]
  /** 下一个节点ID */
  next?: string
}

/** 连接线 */
export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

interface WorkflowStore {
  /** 工作流列表 */
  workflows: WorkflowDef[]
  /** 当前编辑的工作流 */
  currentWorkflow: WorkflowDef | null
  /** 可视化节点 */
  nodes: WorkflowNode[]
  /** 连接线 */
  edges: WorkflowEdge[]
  /** 选中的节点ID */
  selectedNodeId: string | null
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null
  /** 是否有未保存的修改 */
  isDirty: boolean

  // === 工作流列表操作 ===
  fetchWorkflows: (params?: { search?: string }) => Promise<void>
  createWorkflow: (input: { name: string; description?: string }) => Promise<WorkflowDef | null>
  deleteWorkflow: (id: string) => Promise<boolean>

  // === 当前工作流操作 ===
  loadWorkflow: (id: string) => Promise<void>
  saveWorkflow: () => Promise<boolean>

  // === 节点操作 ===
  addNode: (type: WorkflowStepType, position: { x: number; y: number }) => void
  updateNode: (id: string, patch: Partial<WorkflowNode>) => void
  removeNode: (id: string) => void
  selectNode: (id: string | null) => void
  moveNode: (id: string, position: { x: number; y: number }) => void

  // === 连接操作 ===
  addEdge: (source: string, target: string, sourceHandle?: string, targetHandle?: string) => void
  removeEdge: (id: string) => void

  // === 工具方法 ===
  resetEditor: () => void
  nodesToSteps: () => WorkflowStep[]
  stepsToNodes: (steps: WorkflowStep[]) => void
}

/** 生成短ID */
function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/** 根据节点类型生成默认名称 */
function getDefaultName(type: WorkflowStepType): string {
  const names: Record<WorkflowStepType, string> = {
    agent: '智能体节点',
    human_in_loop: '人工审核',
    parallel: '并行执行',
    conditional: '条件判断',
    loop: '循环节点',
  }
  return names[type] || '节点'
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  loading: false,
  error: null,
  isDirty: false,

  // === 工作流列表操作 ===
  fetchWorkflows: async (params) => {
    const hasData = get().workflows.length > 0
    if (!hasData) set({ loading: true, error: null }) // 有数据时不阻塞 UI
    try {
      const sp = new URLSearchParams()
      if (params?.search) sp.set('search', params.search)
      const qs = sp.toString()
      const key = `workflows:${qs}`
      const json = await swrFetch(key, () =>
        fetch(`/api/workflow${qs ? `?${qs}` : ''}`).then(r => r.json())
      )
      if (json.success && json.data?.workflows) {
        set({ workflows: json.data.workflows, loading: false })
      } else {
        set({ loading: false, error: json.error?.message ?? '获取工作流列表失败' })
      }
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  createWorkflow: async (input) => {
    try {
      const res = await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = await res.json()
      if (json.success && json.data?.workflow) {
        invalidateCache('workflows:') // 清除缓存
        await get().fetchWorkflows()
        return json.data.workflow
      }
      set({ error: json.error?.message ?? '创建工作流失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  deleteWorkflow: async (id) => {
    try {
      const res = await fetch(`/api/workflow/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        invalidateCache('workflows:') // 清除缓存
        await get().fetchWorkflows()
        return true
      }
      set({ error: json.error?.message ?? '删除工作流失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  // === 当前工作流操作 ===
  loadWorkflow: async (id) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`/api/workflow/${id}`)
      const json = await res.json()
      if (json.success && json.data?.workflow) {
        const workflow = json.data.workflow
        set({ currentWorkflow: workflow, loading: false })
        // 转换步骤为可视化节点
        get().stepsToNodes(workflow.steps || [])
      } else {
        set({ loading: false, error: json.error?.message ?? '加载工作流失败' })
      }
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  saveWorkflow: async () => {
    const { currentWorkflow, nodesToSteps } = get()
    if (!currentWorkflow) return false

    try {
      const steps = nodesToSteps()
      const res = await fetch(`/api/workflow/${currentWorkflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentWorkflow.name,
          description: currentWorkflow.description,
          steps,
        }),
      })
      const json = await res.json()
      if (json.success && json.data?.workflow) {
        set({ currentWorkflow: json.data.workflow, isDirty: false })
        return true
      }
      set({ error: json.error?.message ?? '保存失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  // === 节点操作 ===
  addNode: (type, position) => {
    const id = generateId()
    const newNode: WorkflowNode = {
      id,
      type,
      name: getDefaultName(type),
      position,
      config: {},
    }
    set((state) => ({
      nodes: [...state.nodes, newNode],
      isDirty: true,
    }))
  },

  updateNode: (id, patch) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      isDirty: true,
    }))
  },

  removeNode: (id) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
      isDirty: true,
    }))
  },

  selectNode: (id) => {
    set({ selectedNodeId: id })
  },

  moveNode: (id, position) => {
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }))
  },

  // === 连接操作 ===
  addEdge: (source, target, sourceHandle, targetHandle) => {
    const id = `${source}-${target}`
    // 避免重复连接
    const exists = get().edges.some((e) => e.id === id)
    if (exists) return

    const newEdge: WorkflowEdge = {
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
    }
    set((state) => ({
      edges: [...state.edges, newEdge],
      isDirty: true,
    }))
  },

  removeEdge: (id) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== id),
      isDirty: true,
    }))
  },

  // === 工具方法 ===
  resetEditor: () => {
    set({
      currentWorkflow: null,
      nodes: [],
      edges: [],
      selectedNodeId: null,
      isDirty: false,
    })
  },

  /** 将可视化节点转换为工作流步骤 */
  nodesToSteps: () => {
    const { nodes, edges } = get()
    if (nodes.length === 0) return []

    // 找到开始节点（没有入边的节点）
    const targetIds = new Set(edges.map((e) => e.target))
    const startNode = nodes.find((n) => !targetIds.has(n.id)) || nodes[0]

    // 按连接顺序遍历节点
    const steps: WorkflowStep[] = []
    const visited = new Set<string>()
    let currentId: string | undefined = startNode.id

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const node = nodes.find((n) => n.id === currentId)
      if (!node) break

      // 找到下一个节点
      const outEdge = edges.find((e) => e.source === currentId)
      const nextId = outEdge?.target

      const step: WorkflowStep = {
        id: node.id,
        type: node.type,
        name: node.name,
        agentName: node.agentName,
        next: nextId,
        // 添加其他配置
        ...((node.config as Record<string, unknown>) || {}),
      }

      steps.push(step)
      currentId = nextId
    }

    return steps
  },

  /** 将工作流步骤转换为可视化节点 */
  stepsToNodes: (steps) => {
    if (steps.length === 0) {
      set({ nodes: [], edges: [] })
      return
    }

    const nodes: WorkflowNode[] = []
    const edges: WorkflowEdge[] = []
    const startX = 100
    const startY = 200
    const gapX = 250

    steps.forEach((step, index) => {
      nodes.push({
        id: step.id,
        type: step.type,
        name: step.name,
        agentName: step.agentName,
        position: { x: startX + index * gapX, y: startY },
        config: {
          actions: step.actions,
          notify: step.notify,
        },
      })

      if (step.next) {
        edges.push({
          id: `${step.id}-${step.next}`,
          source: step.id,
          target: step.next,
        })
      }
    })

    set({ nodes, edges })
  },
}))
