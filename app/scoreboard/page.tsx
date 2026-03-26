'use client'

import { useEffect, useState, useMemo } from 'react'
import type { AgentStats } from '@/lib/types'

const AGENT_INFO: Record<string, { emoji: string; name: string; role: string; color: string }> = {
  'arm-architect': { emoji: '🏛️', name: '架构师', role: '方案设计', color: '#8b5cf6' },
  'arm-dev': { emoji: '💻', name: '开发者', role: '功能实现', color: '#3b82f6' },
  'arm-reviewer': { emoji: '👁️', name: '审查者', role: '代码评审', color: '#10b981' },
  'arm-qa': { emoji: '🧪', name: '测试员', role: '质量保障', color: '#f59e0b' },
}

type SortKey = 'completed' | 'successRate' | 'health' | 'tokenEfficiency'

interface AgentWithMetrics extends AgentStats {
  totalTasks: number
  successRate: number
  tokenEfficiency: number
}

export default function ScoreboardPage() {
  const [agents, setAgents] = useState<AgentStats[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('completed')

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agents')
      const data = await res.json()
      setAgents(data)
    } catch (error) {
      console.error('Failed to fetch agents:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 30000)
    return () => clearInterval(timer)
  }, [])

  const agentsWithMetrics: AgentWithMetrics[] = useMemo(() => {
    return agents.map(agent => {
      const totalTasks = agent.completedTasks + agent.failedTasks
      const successRate = totalTasks > 0 ? (agent.completedTasks / totalTasks) * 100 : 0
      const tokenEfficiency = agent.totalTokens > 0 
        ? agent.completedTasks / (agent.totalTokens / 1000) 
        : 0
      return {
        ...agent,
        totalTasks,
        successRate,
        tokenEfficiency
      }
    })
  }, [agents])

  const sortedAgents = useMemo(() => {
    return [...agentsWithMetrics].sort((a, b) => {
      switch (sortBy) {
        case 'completed':
          return b.completedTasks - a.completedTasks
        case 'successRate':
          return b.successRate - a.successRate
        case 'health':
          return b.health - a.health
        case 'tokenEfficiency':
          return b.tokenEfficiency - a.tokenEfficiency
        default:
          return 0
      }
    })
  }, [agentsWithMetrics, sortBy])

  const top3 = sortedAgents.slice(0, 3)
  const rest = sortedAgents.slice(3)

  const getMedal = (rank: number) => {
    if (rank === 0) return '🥇'
    if (rank === 1) return '🥈'
    if (rank === 2) return '🥉'
    return `${rank + 1}`
  }

  const getHealthColor = (health: number) => {
    if (health >= 80) return '#48bb78'
    if (health >= 50) return '#ecc94b'
    return '#f56565'
  }

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'completed', label: '完成任务' },
    { key: 'successRate', label: '成功率' },
    { key: 'health', label: '生命值' },
    { key: 'tokenEfficiency', label: 'Token效率' },
  ]

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>🏆</div>
          <p style={{ color: '#8892a4', marginTop: '16px' }}>加载中...</p>
        </div>
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', background: '#0f1117' }}>
      {/* Header */}
      <div style={{ maxWidth: '1024px', margin: '0 auto 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '32px' }}>🏆</span>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', margin: 0 }}>Agent 记分板</h1>
              <p style={{ fontSize: '12px', color: '#8892a4', margin: '4px 0 0 0' }}>各 Agent 绩效排名与对比</p>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '14px',
              border: '1px solid #2d3148',
              background: '#1e2130',
              color: '#8892a4',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = '#8892a4'
            }}
          >
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>🔄</span>
            刷新
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1024px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 排序选择 */}
        <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: '#8892a4' }}>📊 排序方式:</span>
            {sortOptions.map(option => (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  border: 'none',
                  cursor: 'pointer',
                  background: sortBy === option.key ? '#3b82f6' : '#0f1117',
                  color: sortBy === option.key ? '#fff' : '#8892a4',
                  transition: 'all 0.2s'
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* TOP3 展示 */}
        <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {top3.map((agent, index) => {
              const info = AGENT_INFO[agent.agentId] || { emoji: '🤖', name: agent.agentId, role: 'Agent', color: '#4a5568' }
              return (
                <div
                  key={agent.agentId}
                  style={{
                    background: '#0f1117',
                    borderRadius: '12px',
                    padding: '20px',
                    border: `2px solid ${index === 0 ? '#f59e0b' : index === 1 ? '#9ca3af' : '#b45309'}`,
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{getMedal(index)}</div>
                  <div style={{ 
                    width: '60px', 
                    height: '60px', 
                    borderRadius: '50%', 
                    background: `${info.color}22`,
                    border: `2px solid ${info.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '28px',
                    margin: '0 auto 12px'
                  }}>
                    {info.emoji}
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff' }}>{info.name}</div>
                  <div style={{ fontSize: '12px', color: '#4a5568', marginBottom: '12px' }}>{info.role}</div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '16px' }}>
                    <div style={{ background: '#1e2130', padding: '8px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: info.color }}>{agent.completedTasks}</div>
                      <div style={{ fontSize: '11px', color: '#4a5568' }}>完成任务</div>
                    </div>
                    <div style={{ background: '#1e2130', padding: '8px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#48bb78' }}>{agent.successRate.toFixed(1)}%</div>
                      <div style={{ fontSize: '11px', color: '#4a5568' }}>成功率</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 详细数据对比表 */}
        <div style={{ background: '#1e2130', borderRadius: '8px', border: '1px solid #2d3148', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', color: '#8892a4', margin: '0 0 16px 0' }}>📋 详细数据对比</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>排名</th>
                  <th style={{ textAlign: 'left', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>Agent</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>完成</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>失败</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>成功率</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>Token消耗</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>效率</th>
                  <th style={{ textAlign: 'center', padding: '12px', fontSize: '12px', color: '#8892a4', fontWeight: 500, borderBottom: '1px solid #2d3148' }}>生命值</th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((agent, index) => {
                  const info = AGENT_INFO[agent.agentId] || { emoji: '🤖', name: agent.agentId, role: 'Agent', color: '#4a5568' }
                  const healthColor = getHealthColor(agent.health)
                  const isTop3 = index < 3
                  return (
                    <tr key={agent.agentId} style={{ borderBottom: '1px solid #2d3148' }}>
                      <td style={{ padding: '12px', fontSize: '14px', color: isTop3 ? '#f59e0b' : '#4a5568', fontWeight: isTop3 ? 'bold' : 'normal' }}>
                        {getMedal(index)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '18px' }}>{info.emoji}</span>
                          <div>
                            <div style={{ fontSize: '14px', color: '#fff', fontWeight: 500 }}>{info.name}</div>
                            <div style={{ fontSize: '11px', color: '#4a5568' }}>{info.role}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#48bb78', fontWeight: 500 }}>
                        {agent.completedTasks}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: agent.failedTasks > 0 ? '#f56565' : '#4a5568' }}>
                        {agent.failedTasks}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#fff', fontWeight: 500 }}>
                        {agent.successRate.toFixed(1)}%
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#8892a4' }}>
                        {(agent.totalTokens / 1000).toFixed(1)}k
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#fff', fontWeight: 500 }}>
                        {agent.tokenEfficiency.toFixed(1)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                          <span style={{ fontSize: '14px', color: healthColor, fontWeight: 'bold' }}>{agent.health}%</span>
                          {isTop3 && <span style={{ fontSize: '14px' }}>⭐</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
