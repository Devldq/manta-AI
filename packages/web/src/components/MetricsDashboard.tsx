/* 指标仪表板组件 */
import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, Users, Zap, Clock, CheckCircle } from 'lucide-react'

interface Metric {
  label: string
  value: string | number
  change: string
  changeType: 'positive' | 'negative'
  icon: React.ReactNode
}

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 模拟指标数据
    const mockMetrics: Metric[] = [
      {
        label: 'Total Tasks',
        value: 1234,
        change: '+12%',
        changeType: 'positive',
        icon: <BarChart3 size={24} />
      },
      {
        label: 'Active Users',
        value: 567,
        change: '+8%',
        changeType: 'positive',
        icon: <Users size={24} />
      },
      {
        label: 'Success Rate',
        value: '98.5%',
        change: '+2.3%',
        changeType: 'positive',
        icon: <CheckCircle size={24} />
      },
      {
        label: 'Avg Response',
        value: '1.2s',
        change: '-0.3s',
        changeType: 'positive',
        icon: <Clock size={24} />
      }
    ]
    setMetrics(mockMetrics)
    setLoading(false)
  }, [])

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface-elevated rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Metrics Dashboard</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <div key={index} className="bg-surface-elevated rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="text-text-muted">{metric.icon}</div>
              <span className={`text-sm ${metric.changeType === 'positive' ? 'text-green-500' : 'text-red-500'}`}>
                {metric.change}
              </span>
            </div>
            <p className="mt-4 text-3xl font-bold">{metric.value}</p>
            <p className="mt-1 text-sm text-text-muted">{metric.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface-elevated rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Task Distribution</h3>
          <div className="space-y-3">
            {[
              { label: 'Code Generation', value: 45, color: 'bg-blue-500' },
              { label: 'Bug Fixing', value: 25, color: 'bg-green-500' },
              { label: 'Documentation', value: 15, color: 'bg-yellow-500' },
              { label: 'Other', value: 15, color: 'bg-gray-500' }
            ].map((item, index) => (
              <div key={index} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{item.label}</span>
                  <span className="text-text-muted">{item.value}%</span>
                </div>
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${item.color} rounded-full`}
                    style={{ width: `${item.value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-elevated rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
          <div className="space-y-4">
            {[
              { text: 'Task #1234 completed', time: '2 minutes ago' },
              { text: 'New workspace created', time: '5 minutes ago' },
              { text: 'User signed up', time: '10 minutes ago' },
              { text: 'Task #1233 started', time: '15 minutes ago' }
            ].map((activity, index) => (
              <div key={index} className="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
                <span className="text-sm">{activity.text}</span>
                <span className="text-xs text-text-muted">{activity.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
