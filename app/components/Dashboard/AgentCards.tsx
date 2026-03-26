'use client'

import { useRouter } from 'next/navigation'
import type { AgentStats } from '@/lib/types'

const AGENT_INFO: Record<string, { emoji: string; name: string; role: string }> = {
  'arm-architect': { emoji: '🏛️', name: '架构师', role: '方案设计' },
  'arm-dev': { emoji: '💻', name: '开发者', role: '功能实现' },
  'arm-reviewer': { emoji: '👁️', name: '审查者', role: '代码评审' },
  'arm-qa': { emoji: '🧪', name: '测试员', role: '质量保障' },
}

interface AgentCardsProps {
  agents: AgentStats[]
}

export function AgentCards({ agents }: AgentCardsProps) {
  const router = useRouter()

  const getHealthColor = (health: number) => {
    if (health >= 80) return '#48bb78'
    if (health >= 50) return '#ecc94b'
    return '#f56565'
  }

  return (
    <div className="card p-5" style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148' }}>
      <h3 className="text-sm font-medium mb-4" style={{ color: '#8892a4' }}>🤖 Agent 状态</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        {agents.map(agent => {
          const info = AGENT_INFO[agent.agentId] || { emoji: '🤖', name: agent.agentId, role: 'Agent' }
          const healthColor = getHealthColor(agent.health)
          
          return (
            <div
              key={agent.agentId}
              onClick={() => router.push(`/agents/${agent.agentId}`)}
              style={{ 
                padding: '12px', 
                borderRadius: '8px', 
                cursor: 'pointer',
                background: '#0f1117',
                border: '1px solid #2d3148',
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.05)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '24px', marginBottom: '4px' }}>{info.emoji}</div>
                <div style={{ fontSize: '12px', color: '#fff', fontWeight: 500 }}>{info.name}</div>
                <div style={{ fontSize: '11px', color: '#4a5568' }}>{info.role}</div>
                <div style={{ marginTop: '8px', fontSize: '16px', fontWeight: 'bold', color: healthColor }}>
                  {agent.health}%
                </div>
                <div style={{ height: '6px', borderRadius: '4px', overflow: 'hidden', marginTop: '4px', background: '#2d3148' }}>
                  <div 
                    style={{ 
                      height: '100%', 
                      borderRadius: '4px', 
                      width: `${agent.health}%`, 
                      background: healthColor,
                      transition: 'width 0.3s'
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
