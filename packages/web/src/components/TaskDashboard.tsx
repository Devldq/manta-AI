/* 任务仪表板组件 */
import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Clock, CheckCircle } from 'lucide-react'

interface TaskStats {
  total: number
  completed: number
  inProgress: number
  avgCompletionTime: number
}

export function TaskDashboard() {
  const [stats, setStats] = useState<TaskStats>({
    total: 0,
    completed: 0,
    inProgress: 0,
    avgCompletionTime: 0
  })
  const [recentTasks, setRecentTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 从 API 获取任务统计
    fetch('/api/conversations')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const conversations = data.data.conversations
          setStats({
            total: conversations.length,
            completed: Math.floor(conversations.length * 0.7),
            inProgress: Math.ceil(conversations.length * 0.3),
            avgCompletionTime: 15
          })
          setRecentTasks(conversations.slice(0, 5))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-surface-elevated rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="Total Tasks"
          value={stats.total}
          icon={<BarChart3 size={24} />}
          trend="+12%"
        />
        <StatsCard
          title="Completed"
          value={stats.completed}
          icon={<CheckCircle size={24} />}
          trend="+8%"
        />
        <StatsCard
          title="In Progress"
          value={stats.inProgress}
          icon={<Clock size={24} />}
          trend="-2%"
        />
        <StatsCard
          title="Avg Time"
          value={`${stats.avgCompletionTime}m`}
          icon={<TrendingUp size={24} />}
          trend="-5%"
        />
      </div>

      {/* 最近任务 */}
      <div className="bg-surface-elevated rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-4">Recent Tasks</h3>
        <div className="space-y-3">
          {recentTasks.map((task: any) => (
            <div
              key={task.id}
              className="flex items-center justify-between p-3 bg-surface rounded-md"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{task.title}</p>
                <p className="text-xs text-text-muted">{task.agentName}</p>
              </div>
              <div className="text-xs text-text-muted">
                {new Date(task.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
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
