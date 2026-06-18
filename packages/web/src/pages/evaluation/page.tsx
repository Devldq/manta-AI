/* 评估页 — /evaluation */
import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Edit3, BarChart3, TrendingUp, CheckCircle,
  XCircle, Loader2, RefreshCw, Play, Pause
} from 'lucide-react'

interface EvaluationTask {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalCases: number
  passedCases: number
  failedCases: number
  createdAt: string
  completedAt?: string
}

export default function EvaluationPage() {
  const [evaluations, setEvaluations] = useState<EvaluationTask[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newEvalName, setNewEvalName] = useState('')
  const [creating, setCreating] = useState(false)

  const loadEvaluations = useCallback(async () => {
    try {
      // 模拟数据
      const mockData: EvaluationTask[] = [
        {
          id: '1',
          name: '代码生成质量评估',
          status: 'completed',
          progress: 100,
          totalCases: 50,
          passedCases: 45,
          failedCases: 5,
          createdAt: '2024-01-15T10:30:00Z',
          completedAt: '2024-01-15T11:45:00Z'
        },
        {
          id: '2',
          name: '对话连贯性测试',
          status: 'running',
          progress: 65,
          totalCases: 30,
          passedCases: 18,
          failedCases: 2,
          createdAt: '2024-01-15T12:00:00Z'
        },
        {
          id: '3',
          name: '安全性检测',
          status: 'pending',
          progress: 0,
          totalCases: 100,
          passedCases: 0,
          failedCases: 0,
          createdAt: '2024-01-15T13:00:00Z'
        }
      ]
      setEvaluations(mockData)
    } catch (error) {
      console.error('Failed to load evaluations:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEvaluations()
  }, [loadEvaluations])

  const handleCreateEval = async () => {
    if (!newEvalName.trim()) return

    setCreating(true)
    try {
      const newEval: EvaluationTask = {
        id: String(Date.now()),
        name: newEvalName.trim(),
        status: 'pending',
        progress: 0,
        totalCases: 0,
        passedCases: 0,
        failedCases: 0,
        createdAt: new Date().toISOString()
      }
      setEvaluations(prev => [...prev, newEval])
      setShowCreateModal(false)
      setNewEvalName('')
    } catch (error) {
      console.error('Failed to create evaluation:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteEval = async (id: string) => {
    if (!confirm('确定删除此评估任务？')) return

    try {
      setEvaluations(prev => prev.filter(e => e.id !== id))
    } catch (error) {
      console.error('Failed to delete evaluation:', error)
    }
  }

  const handleStartEval = async (id: string) => {
    try {
      setEvaluations(prev => prev.map(e =>
        e.id === id ? { ...e, status: 'running' as const } : e
      ))
    } catch (error) {
      console.error('Failed to start evaluation:', error)
    }
  }

  const handleStopEval = async (id: string) => {
    try {
      setEvaluations(prev => prev.map(e =>
        e.id === id ? { ...e, status: 'pending' as const } : e
      ))
    } catch (error) {
      console.error('Failed to stop evaluation:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            评估任务
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            管理和监控 AI 模型评估任务
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-text-inverse transition-colors"
        >
          <Plus size={16} />
          创建评估
        </button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="总任务数"
          value={evaluations.length}
          icon={<BarChart3 size={24} />}
          trend="+12%"
        />
        <StatsCard
          title="运行中"
          value={evaluations.filter(e => e.status === 'running').length}
          icon={<Play size={24} />}
          trend="+5%"
        />
        <StatsCard
          title="已完成"
          value={evaluations.filter(e => e.status === 'completed').length}
          icon={<CheckCircle size={24} />}
          trend="+8%"
        />
        <StatsCard
          title="平均通过率"
          value={`${Math.round(evaluations.reduce((acc, e) => acc + (e.totalCases > 0 ? (e.passedCases / e.totalCases) * 100 : 0), 0) / evaluations.length)}%`}
          icon={<TrendingUp size={24} />}
          trend="+2%"
        />
      </div>

      {/* 评估列表 */}
      <div className="space-y-4">
        {evaluations.map((evalTask) => (
          <div key={evalTask.id} className="bg-surface-elevated rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-text-primary">{evalTask.name}</h3>
                <span className={`px-2 py-1 rounded-full text-xs ${
                  evalTask.status === 'completed' ? 'bg-green-500/15 text-green-500' :
                  evalTask.status === 'running' ? 'bg-blue-500/15 text-blue-500' :
                  evalTask.status === 'failed' ? 'bg-red-500/15 text-red-500' :
                  'bg-gray-500/15 text-gray-500'
                }`}>
                  {evalTask.status === 'completed' ? '已完成' :
                   evalTask.status === 'running' ? '运行中' :
                   evalTask.status === 'failed' ? '失败' : '待运行'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {evalTask.status === 'pending' && (
                  <button
                    onClick={() => handleStartEval(evalTask.id)}
                    className="p-1.5 hover:bg-surface rounded text-text-muted"
                    title="开始"
                  >
                    <Play size={16} />
                  </button>
                )}
                {evalTask.status === 'running' && (
                  <button
                    onClick={() => handleStopEval(evalTask.id)}
                    className="p-1.5 hover:bg-surface rounded text-text-muted"
                    title="停止"
                  >
                    <Pause size={16} />
                  </button>
                )}
                <button
                  onClick={() => handleDeleteEval(evalTask.id)}
                  className="p-1.5 hover:bg-surface rounded text-text-muted"
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* 进度条 */}
            {evalTask.status === 'running' && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>进度</span>
                  <span>{evalTask.progress}%</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${evalTask.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* 统计信息 */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-semibold text-text-primary">{evalTask.totalCases}</p>
                <p className="text-xs text-text-muted">总用例</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-green-500">{evalTask.passedCases}</p>
                <p className="text-xs text-text-muted">通过</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-red-500">{evalTask.failedCases}</p>
                <p className="text-xs text-text-muted">失败</p>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border-subtle flex justify-between text-xs text-text-muted">
              <span>创建于 {new Date(evalTask.createdAt).toLocaleString()}</span>
              {evalTask.completedAt && (
                <span>完成于 {new Date(evalTask.completedAt).toLocaleString()}</span>
              )}
            </div>
          </div>
        ))}

        {evaluations.length === 0 && (
          <div className="text-center py-12 text-text-muted">
            暂无评估任务
          </div>
        )}
      </div>

      {/* 创建模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md p-6 bg-surface rounded-lg shadow-xl">
            <h2 className="text-lg font-semibold mb-4 text-text-primary">创建评估任务</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">任务名称 *</label>
                <input
                  type="text"
                  value={newEvalName}
                  onChange={(e) => setNewEvalName(e.target.value)}
                  placeholder="评估任务名称"
                  className="w-full px-3 py-2 bg-surface-elevated rounded-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-text-secondary hover:bg-surface-elevated rounded-md transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCreateEval}
                disabled={creating || !newEvalName.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : null}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatsCard({ title, value, icon, trend }: {
  title: string
  value: string | number
  icon: React.ReactNode
  trend: string
}) {
  return (
    <div className="bg-surface-elevated rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="text-text-muted">{icon}</div>
        <span className={`text-xs ${trend.startsWith('+') ? 'text-green-500' : 'text-red-500'}`}>
          {trend}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold">{value}</p>
      <p className="text-sm text-text-muted">{title}</p>
    </div>
  )
}
