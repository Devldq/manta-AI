/* 系统日志组件 */
import { useState, useEffect, useRef } from 'react'
import { Terminal, Trash2, Download, RefreshCw } from 'lucide-react'

interface LogEntry {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source?: string
}

export function SystemLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error' | 'debug'>('all')
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 模拟日志数据
    const mockLogs: LogEntry[] = [
      { id: '1', timestamp: new Date().toISOString(), level: 'info', message: 'Server started on port 3001', source: 'server' },
      { id: '2', timestamp: new Date().toISOString(), level: 'info', message: 'Connected to storage', source: 'storage' },
      { id: '3', timestamp: new Date().toISOString(), level: 'warn', message: 'Rate limit approaching', source: 'api' },
      { id: '4', timestamp: new Date().toISOString(), level: 'error', message: 'Failed to fetch conversation', source: 'conversation' },
      { id: '5', timestamp: new Date().toISOString(), level: 'debug', message: 'Cache miss for key: user-123', source: 'cache' },
    ]
    setLogs(mockLogs)
    setLoading(false)
  }, [])

  const filteredLogs = filter === 'all' ? logs : logs.filter(log => log.level === filter)

  const levelColors = {
    info: 'text-blue-500',
    warn: 'text-yellow-500',
    error: 'text-red-500',
    debug: 'text-gray-500'
  }

  const handleClear = () => {
    setLogs([])
  }

  const handleExport = () => {
    const logText = logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`
    ).join('\n')
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'logs.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="h-64 bg-surface-elevated rounded-lg animate-pulse" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Terminal size={20} />
          <h2 className="text-lg font-semibold">System Logs</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-1.5 bg-surface-elevated rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="all">All</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          <button
            onClick={handleClear}
            className="p-1.5 hover:bg-surface-elevated rounded-md transition-colors"
            title="Clear logs"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={handleExport}
            className="p-1.5 hover:bg-surface-elevated rounded-md transition-colors"
            title="Export logs"
          >
            <Download size={16} />
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div className="flex-1 overflow-auto p-4 font-mono text-sm">
        {filteredLogs.map((log) => (
          <div key={log.id} className="flex items-start gap-4 py-1">
            <span className="text-text-muted whitespace-nowrap">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className={`whitespace-nowrap ${levelColors[log.level]}`}>
              [{log.level.toUpperCase()}]
            </span>
            {log.source && (
              <span className="text-text-muted whitespace-nowrap">
                [{log.source}]
              </span>
            )}
            <span className="text-text-primary break-all">{log.message}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      {/* 底部状态栏 */}
      <div className="p-2 border-t border-border-subtle flex items-center justify-between text-xs text-text-muted">
        <span>{filteredLogs.length} entries</span>
        <span>Last updated: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
