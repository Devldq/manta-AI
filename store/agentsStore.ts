import { create } from 'zustand'
import type { AgentStats } from '@/lib/types'

/* AI start: Agent 状态 Store */
interface AgentsState {
  agents: AgentStats[]
  loading: boolean
  fetchAgents: () => Promise<void>
  scoreAgent: (agentId: string, action: 'ok' | 'x') => Promise<{ event: string; replacement?: AgentStats }>
  cloneAgent: (agentId: string) => Promise<AgentStats>
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  loading: false,

  fetchAgents: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/agents')
      const agents = await res.json()
      set({ agents })
    } finally {
      set({ loading: false })
    }
  },

  scoreAgent: async (agentId, action) => {
    const res = await fetch('/api/score-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, action }),
    })
    const data = await res.json()
    // AI: 刷新 Agent 列表
    const agentsRes = await fetch('/api/agents')
    const agents = await agentsRes.json()
    set({ agents })
    return data
  },

  cloneAgent: async (agentId) => {
    const res = await fetch(`/api/agents/${agentId}/clone`, { method: 'POST' })
    if (!res.ok) {
      const { error } = await res.json()
      throw new Error(error)
    }
    const newAgent = await res.json()
    const agentsRes = await fetch('/api/agents')
    const agents = await agentsRes.json()
    set({ agents })
    return newAgent
  },
}))
/* AI end: Agent 状态 Store */
