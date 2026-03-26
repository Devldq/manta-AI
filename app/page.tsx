'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TaskStats } from './components/Dashboard/TaskStats'
import { AgentCards } from './components/Dashboard/AgentCards'
import { RecentTasks } from './components/Dashboard/RecentTasks'
import { QuickActions } from './components/Dashboard/QuickActions'
import type { Task, AgentStats } from '@/lib/types'

export default function HomePage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<AgentStats[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/agents')
      ])
      const [tasksData, agentsData] = await Promise.all([
        tasksRes.json(),
        agentsRes.json()
      ])
      setTasks(tasksData)
      setAgents(agentsData)
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 30000)
    return () => clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f1117' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }}>🏛️</div>
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
            <span style={{ fontSize: '32px' }}>🏛️</span>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', margin: 0 }}>ARM 控制台</h1>
              <p style={{ fontSize: '12px', color: '#8892a4', margin: '4px 0 0 0' }}>前端研发工作流 · 多 Agent 协作</p>
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

      {/* Dashboard Content */}
      <div style={{ maxWidth: '1024px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* 任务概览 */}
        <TaskStats tasks={tasks} />
        
        {/* Agent 状态 + 快速操作 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
          <AgentCards agents={agents} />
          <QuickActions />
        </div>
        
        {/* 近期任务 */}
        <RecentTasks tasks={tasks} />
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
