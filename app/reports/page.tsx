'use client'
import { useEffect, useState } from 'react'
import { useTasksStore } from '@/store/tasksStore'
import { useAgentsStore } from '@/store/agentsStore'
import type { Task } from '@/lib/types'
import { RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react'

/* AI start: 报告中心页面 — QA + CR 报告查看 + 打分 */

interface Report {
  taskId: string
  title: string
  status: string
  qaReport: string
  reviewReport: string
  qaDone: boolean
  reviewDone: boolean
}

export default function ReportsPage() {
  const { tasks, fetchTasks } = useTasksStore()
  const { scoreAgent, fetchAgents } = useAgentsStore()
  const [reports, setReports] = useState<Record<string, Report>>({})
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [scoring, setScoring] = useState<string | null>(null)
  const [scoreMsg, setScoreMsg] = useState<string | null>(null)

  // AI: 报告中心展示所有有 QA/CR 报告的任务（通用化，不依赖 PendingScore 状态）
  const scorableTasks = tasks.filter(t => t.status === 'Done' || (t as { status: string }).status === 'PendingScore')

  useEffect(() => {
    fetchTasks()
    fetchAgents()
    const timer = setInterval(fetchTasks, 15000)
    return () => clearInterval(timer)
  }, [fetchTasks, fetchAgents])

  const loadReport = async (taskId: string) => {
    if (reports[taskId]) return
    const res = await fetch(`/api/reports/${taskId}`)
    if (res.ok) {
      const data = await res.json()
      setReports(r => ({ ...r, [taskId]: data }))
    }
  }

  const handleSelect = (task: Task) => {
    setSelectedTaskId(task.id)
    setScoreMsg(null)
    loadReport(task.id)
  }

  const handleScore = async (agentId: string, action: 'ok' | 'x') => {
    setScoring(agentId)
    try {
      const result = await scoreAgent(agentId, action)
      const label = action === 'ok' ? '+10分 ✅' : '-10分 ❌'
      if (result.event === 'can_clone') {
        setScoreMsg(`${label} · ${agentId} 生命值达到90分，可以复制！`)
      } else if (result.event === 'banned') {
        setScoreMsg(`${label} · ${agentId} 已封禁，系统生成了替代 Agent`)
      } else {
        setScoreMsg(`${label} · 已记录`)
      }
    } catch (e: unknown) {
      setScoreMsg(`打分失败: ${(e as Error).message}`)
    } finally {
      setScoring(null)
    }
  }

  const currentReport = selectedTaskId ? reports[selectedTaskId] : null
  const currentTask = tasks.find(t => t.id === selectedTaskId)

  return (
    <div className="flex flex-col h-screen">
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">📊 报告中心</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>
            {scorableTasks.filter(t => (t as { status: string }).status === 'PendingScore').length} 个待打分（自定义工作流）
          </p>
        </div>
        <button onClick={() => fetchTasks()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}>
          <RefreshCw size={12} />刷新
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* AI: 左侧任务列表 */}
        <div className="w-72 flex-shrink-0 border-r overflow-y-auto" style={{ borderColor: '#2d3148' }}>
          {scorableTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6">
              <div className="text-4xl mb-3">📊</div>
              <p className="text-sm font-medium text-white">暂无报告</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <div className="text-xs px-1 mb-2 font-medium" style={{ color: '#8892a4' }}>待打分（工作流触发）</div>
              {scorableTasks.filter(t => (t as { status: string }).status === 'PendingScore').map(task => (
                <div
                  key={task.id}
                  onClick={() => handleSelect(task)}
                  className="p-3 rounded-lg cursor-pointer"
                  style={{
                    background: selectedTaskId === task.id ? '#252a3a' : '#1e2130',
                    border: `1px solid ${selectedTaskId === task.id ? '#f59e0b' : '#2d3148'}`,
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#b45309', color: '#fef3c7' }}>待打分</span>
                  </div>
                  <div className="text-sm font-medium text-white">{task.title}</div>
                </div>
              ))}
              {scorableTasks.some(t => t.status === 'Done') && (
                <>
                  <div className="text-xs px-1 mt-3 mb-2 font-medium" style={{ color: '#4a5568' }}>已完成</div>
                  {scorableTasks.filter(t => t.status === 'Done').map(task => (
                    <div
                      key={task.id}
                      onClick={() => handleSelect(task)}
                      className="p-3 rounded-lg cursor-pointer opacity-60"
                      style={{ background: selectedTaskId === task.id ? '#252a3a' : '#1e2130', border: `1px solid ${selectedTaskId === task.id ? '#3b82f6' : '#2d3148'}` }}
                    >
                      <div className="text-sm font-medium text-white">{task.title}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* AI: 右侧报告详情 */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedTaskId ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-3">📄</div>
              <p className="text-sm font-medium text-white">选择一个任务查看报告</p>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-bold text-white mb-1">{currentTask?.title}</h2>
              <p className="text-xs mb-6" style={{ color: '#8892a4' }}>任务 ID: {selectedTaskId}</p>

              {/* AI: QA + Review 报告并排展示 */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="rounded-xl p-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">⚖️</span>
                    <span className="text-sm font-medium text-white">QA 报告</span>
                    {currentReport?.qaDone && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#1a3a2a', color: '#68d391' }}>已完成</span>}
                  </div>
                  {currentReport?.qaReport ? (
                    <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: '#a0aec0' }}>{currentReport.qaReport}</pre>
                  ) : (
                    <p className="text-xs" style={{ color: '#4a5568' }}>QA 报告待生成...</p>
                  )}
                </div>
                <div className="rounded-xl p-4" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">🔍</span>
                    <span className="text-sm font-medium text-white">CR 报告</span>
                    {currentReport?.reviewDone && <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#1a3a2a', color: '#68d391' }}>已完成</span>}
                  </div>
                  {currentReport?.reviewReport ? (
                    <pre className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: '#a0aec0' }}>{currentReport.reviewReport}</pre>
                  ) : (
                    <p className="text-xs" style={{ color: '#4a5568' }}>CR 报告待生成...</p>
                  )}
                </div>
              </div>

              {/* AI: 打分区域 */}
              {(currentTask as { status: string } | undefined)?.status === 'PendingScore' && (
                <div className="rounded-xl p-5" style={{ background: '#1a1d27', border: '1px solid #2d3148' }}>
                  <h3 className="text-sm font-medium text-white mb-1">打分评价</h3>
                  <p className="text-xs mb-4" style={{ color: '#8892a4' }}>对参与本任务的 Agent 进行评分</p>
                  {scoreMsg && (
                    <div className="mb-4 px-3 py-2 rounded-lg text-xs" style={{ background: '#252a3a', color: '#a0aec0' }}>
                      {scoreMsg}
                    </div>
                  )}
                  <div className="space-y-3">
                    {(['architect', 'dev', 'qa', 'review'] as const).map(agentId => {
                      const labels: Record<string, string> = { architect: '📜 架构师', dev: '⚔️ 开发工程师', qa: '⚖️ QA 工程师', review: '🔍 代码审查官' }
                      return (
                        <div key={agentId} className="flex items-center justify-between p-3 rounded-lg" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                          <span className="text-sm text-white">{labels[agentId]}</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleScore(agentId, 'ok')}
                              disabled={!!scoring}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{ background: '#1a3a2a', border: '1px solid #276749', color: '#68d391' }}
                            >
                              <ThumbsUp size={12} />ok +5
                            </button>
                            <button
                              onClick={() => handleScore(agentId, 'x')}
                              disabled={!!scoring}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                              style={{ background: '#2d1515', border: '1px solid #9b2c2c', color: '#fc8181' }}
                            >
                              <ThumbsDown size={12} />x -5
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 报告中心页面 */
