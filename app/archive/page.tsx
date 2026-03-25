'use client'
import { useEffect, useState } from 'react'
import type { Task } from '@/lib/types'
import { RefreshCw, Search } from 'lucide-react'

/* AI start: 归档阁页面 — 已完成任务文档归档 */

interface ArchivedTask extends Task {
  outputs: Record<string, string>
}

const AGENT_LABELS: Record<string, string> = {
  architect: '📜 架构方案',
  dev: '⚔️ 开发摘要',
  qa: '⚖️ QA 报告',
  review: '🔍 CR 报告',
}

export default function ArchivePage() {
  const [tasks, setTasks] = useState<ArchivedTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ArchivedTask | null>(null)
  const [activeTab, setActiveTab] = useState<string>('architect')
  const [search, setSearch] = useState('')

  const fetchArchive = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/archive')
      const data = await res.json()
      setTasks(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchArchive()
  }, [])

  const filtered = tasks.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-screen">
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">📚 归档阁</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>{tasks.length} 个已完成任务</p>
        </div>
        <button
          onClick={fetchArchive}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
          style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* AI: 左侧归档列表 */}
        <div className="w-72 flex-shrink-0 border-r flex flex-col overflow-hidden" style={{ borderColor: '#2d3148' }}>
          {/* AI: 搜索框 */}
          <div className="p-3 border-b" style={{ borderColor: '#2d3148' }}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: '#0f1117', border: '1px solid #2d3148' }}>
              <Search size={12} style={{ color: '#4a5568' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索任务..."
                className="flex-1 text-xs bg-transparent text-white outline-none"
                style={{ color: '#a0aec0' }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: '#4a5568' }}>暂无归档记录</div>
            ) : (
              filtered.map(task => (
                <div
                  key={task.id}
                  onClick={() => { setSelected(task); setActiveTab(Object.keys(task.outputs)[0] ?? 'architect') }}
                  className="p-3 rounded-lg cursor-pointer"
                  style={{
                    background: selected?.id === task.id ? '#252a3a' : '#1e2130',
                    border: `1px solid ${selected?.id === task.id ? '#3b82f6' : '#2d3148'}`,
                  }}
                >
                  <div className="text-sm font-medium text-white mb-1">{task.title}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: '#4a5568' }}>
                      {new Date(task.updatedAt).toLocaleDateString('zh-CN')}
                    </span>
                    <div className="flex gap-1">
                      {Object.keys(task.outputs).map(k => (
                        <span key={k} className="text-xs">{AGENT_LABELS[k]?.split(' ')[0]}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* AI: 右侧文档查看 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              {/* AI: 标签栏 */}
              <div className="flex items-center gap-1 px-4 py-2 border-b" style={{ borderColor: '#2d3148' }}>
                <span className="text-sm font-medium text-white mr-3">{selected.title}</span>
                {Object.keys(selected.outputs).map(agentId => (
                  <button
                    key={agentId}
                    onClick={() => setActiveTab(agentId)}
                    className="px-3 py-1 rounded text-xs transition-colors"
                    style={{
                      background: activeTab === agentId ? '#3b82f6' : '#1e2130',
                      color: activeTab === agentId ? '#fff' : '#8892a4',
                    }}
                  >
                    {AGENT_LABELS[agentId] ?? agentId}
                  </button>
                ))}
              </div>
              {/* AI: 文档内容 */}
              <div className="flex-1 overflow-y-auto p-6">
                {selected.outputs[activeTab] ? (
                  <pre className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: '#a0aec0' }}>
                    {selected.outputs[activeTab]}
                  </pre>
                ) : (
                  <p className="text-xs" style={{ color: '#4a5568' }}>该 Agent 暂无产出文档</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-3">📚</div>
              <p className="text-sm font-medium text-white">选择一个归档任务</p>
              <p className="text-xs mt-1" style={{ color: '#8892a4' }}>查看各 Agent 的产出文档</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 归档阁页面 */
