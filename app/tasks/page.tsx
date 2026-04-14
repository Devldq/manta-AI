/*  start: 任务页面 — 左侧列表 + 右侧聊天 */
'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// AI: 任务状态类型
type TaskStatus = 'inbox' | 'planning' | 'running' | 'done' | 'failed' | 'archived'

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  mode: 'lightweight' | 'workflow'
  agentName?: string
  workflowId?: string
  createdAt: string
  updatedAt: string
  error?: string
  outputDir?: string
}

interface LogEntry {
  timestamp: string
  type: 'user' | 'system' | 'log' | 'output'
  content: string
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  inbox: '待处理',
  planning: '规划中',
  running: '进行中',
  done: '已完成',
  failed: '失败',
  archived: '已归档',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: '#6b7280',
  planning: '#a855f7',
  running: '#3b82f6',
  done: '#22c55e',
  failed: '#ef4444',
  archived: '#6b7280',
}

export default function TasksPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialTaskId = searchParams.get('taskId')
  const isNewMode = searchParams.get('new') === 'true'  // AI: v7 新建模式标识

  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // AI: 任务详情缓存（避免重复加载）
  const taskDetailsCache = useRef<Map<string, { task: Task; logs: LogEntry[] }>>(new Map())

  // AI: 同步 URL 参数到内部状态
  useEffect(() => {
    const urlTaskId = searchParams.get('taskId')
    if (urlTaskId !== selectedTaskId) {
      setSelectedTaskId(urlTaskId)
    }
  }, [searchParams])

  // AI: 加载任务列表
  useEffect(() => {
    fetchTasks()
    const timer = setInterval(fetchTasks, 5000)
    return () => clearInterval(timer)
  }, [])

  async function fetchTasks() {
    try {
      const res = await fetch('/api/tasks')
      const data = await res.json()
      const all = (data.tasks ?? []).filter((t: Task) => t.status !== 'archived')
      setTasks(all)
    } catch {}
  }

  // AI: 内部状态变化时加载任务详情（带缓存优化）
  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null)
      setLogs([])
      return
    }

    const task = tasks.find(t => t.id === selectedTaskId)
    if (!task) return

    // AI: 检查缓存（立即显示，避免白屏）
    const cached = taskDetailsCache.current.get(selectedTaskId)
    if (cached) {
      setSelectedTask(cached.task)
      setLogs(cached.logs)
      setLoading(false)
      // 后台刷新最新数据
      loadTaskDetails(selectedTaskId, task, true)
      return
    }

    // AI: 无缓存时显示加载状态
    setSelectedTask(task)
    setLoading(true)
    loadTaskDetails(selectedTaskId, task, false)
  }, [selectedTaskId, tasks])

  async function loadTaskDetails(taskId: string, task: Task, silent: boolean) {
    try {
      const [logsData, outputData] = await Promise.all([
        fetch(`/api/tasks/${taskId}/logs`).then(r => r.json()),
        fetch(`/api/tasks/${taskId}/output`).then(r => r.json()),
      ])

      const entries: LogEntry[] = []

      if (task.description) {
        entries.push({
          timestamp: task.createdAt,
          type: 'user',
          content: task.description,
        })
      }

      entries.push({
        timestamp: task.createdAt,
        type: 'system',
        content: `任务已创建 - ${task.agentName || task.workflowId || '未指定执行器'}`,
      })

      if (logsData.logs) {
        const logLines = logsData.logs.split('\n').filter((line: string) => line.trim())
        logLines.forEach((line: string) => {
          const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\](.*)/)
          entries.push({
            timestamp: match ? match[1] : new Date().toISOString(),
            type: 'log',
            content: match ? match[2].trim() : line,
          })
        })
      }

      if (outputData.content && task.status === 'done') {
        entries.push({
          timestamp: task.updatedAt,
          type: 'output',
          content: outputData.content,
        })
      }

      if (task.error) {
        entries.push({
          timestamp: task.updatedAt,
          type: 'system',
          content: `❌ ${task.error}`,
        })
      }

      // AI: 更新缓存
      taskDetailsCache.current.set(taskId, { task, logs: entries })
      
      if (!silent) {
        setSelectedTask(task)
      }
      setLogs(entries)
    } catch (err) {
      if (!silent) {
        setLogs([])
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function handleSelectTask(taskId: string) {
    // AI: 立即更新选中状态（乐观更新，无延迟）
    setSelectedTaskId(taskId)
    // AI: 使用 shallow routing，不重新加载页面
    router.replace(`/tasks?taskId=${taskId}`, { scroll: false })
  }

  async function handleSend() {
    const userMsg = inputText.trim()
    if (!userMsg || sending) return

    setSending(true)
    setInputText('')

    try {
      // AI: v7 新建模式 - 先创建任务
      if (isNewMode) {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: userMsg.slice(0, 50),  // 使用用户输入的前50字符作为标题
            status: 'inbox',
            description: userMsg
          })
        })
        const data = await res.json()
        if (data.task) {
          // 创建成功后切换到正常模式
          router.replace(`/tasks?taskId=${data.task.id}`, { scroll: false })
          // 刷新任务列表
          fetchTasks()
        }
        return
      }

      // AI: 正常模式 - 发送消息到已有任务
      if (!selectedTaskId) return

      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        type: 'user',
        content: userMsg,
      }])

      await fetch(`/api/tasks/${selectedTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })

      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        type: 'system',
        content: '消息已发送',
      }])
    } catch (err) {
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        type: 'system',
        content: `发送失败：${String(err)}`,
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full">
      {/* 左侧：任务列表（侧边栏已显示，这里不重复） */}
      <div className="flex-1 flex items-center justify-center" style={{ display: selectedTaskId || isNewMode ? 'none' : 'flex' }}>
        <p className="text-sm text-text-muted">从左侧任务菜单选择一个任务</p>
      </div>

      {/* AI: v7 新建任务模式 - 欢迎界面 */}
      {isNewMode && !selectedTaskId && (
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 px-6 py-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              新建任务
            </h3>
            <p className="text-sm text-text-muted">
              告诉我你的需求，我会帮你创建任务
            </p>
          </div>

          {/* 欢迎消息区 */}
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-md">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <span style={{ fontSize: '32px' }}>✏️</span>
              </div>
              <h4 className="text-lg font-medium text-text-primary mb-2">
                开始新任务
              </h4>
              <p className="text-sm text-text-muted">
                在下方输入框中描述你的需求，我会立即为你创建任务并开始处理
              </p>
            </div>
          </div>

          {/* 输入栏 */}
          <div className="flex-shrink-0 p-4 border-t border-border">
            <div className="flex gap-3">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="描述你的任务需求...（Shift+Enter 换行）"
                className="flex-1 px-4 py-3 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                rows={3}
                autoFocus
              />
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || sending}
                className="px-4 bg-accent text-text-inverse rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 text-sm self-end"
              >
                {sending ? '...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 右侧：聊天面板 */}
      {selectedTaskId && (
        <div className="flex-1 flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-muted">加载中...</p>
            </div>
          ) : !selectedTask ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-text-muted">任务不存在</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex-shrink-0 px-6 py-4 border-b border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2">
                  {selectedTask.title}
                </h3>
                <div className="flex items-center gap-2">
                  <span
                    className="px-2 py-0.5 text-xs rounded"
                    style={{
                      background: `${STATUS_COLORS[selectedTask.status]}18`,
                      color: STATUS_COLORS[selectedTask.status],
                      border: `1px solid ${STATUS_COLORS[selectedTask.status]}40`,
                    }}
                  >
                    {STATUS_LABELS[selectedTask.status]}
                  </span>
                  <span className="text-xs text-text-muted font-mono">
                    {selectedTask.agentName || selectedTask.workflowId || '未指定'}
                  </span>
                </div>
              </div>

              {/* 消息区 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {logs.map((log, idx) => (
                  <div key={idx}>
                    {log.type === 'user' ? (
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex-shrink-0 flex items-center justify-center text-xs">
                          U
                        </div>
                        <div className="flex-1 bg-surface border border-border rounded-lg px-4 py-3">
                          <p className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                            {log.content}
                          </p>
                        </div>
                      </div>
                    ) : log.type === 'system' ? (
                      <div className="flex justify-center">
                        <span className="text-xs text-text-muted bg-surface px-4 py-1.5 rounded-full border border-border">
                          {log.content}
                        </span>
                      </div>
                    ) : log.type === 'log' ? (
                      <div className="pl-11">
                        <p className="text-xs font-mono text-text-muted leading-relaxed">
                          {log.content}
                        </p>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs"
                          style={{ background: 'var(--color-accent)', color: '#000' }}
                        >
                          M
                        </div>
                        <div className="flex-1 bg-accent/10 border border-accent/20 rounded-lg px-4 py-3">
                          <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono leading-relaxed">
                            {log.content}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* 输入栏 */}
              <div className="flex-shrink-0 p-4 border-t border-border">
                <div className="flex gap-3">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="继续对话...（Shift+Enter 换行）"
                    className="flex-1 px-4 py-3 text-sm border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                    rows={2}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputText.trim() || sending}
                    className="px-4 bg-accent text-text-inverse rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 text-sm self-end"
                  >
                    {sending ? '...' : '发送'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
/*  end: 任务页面结束 */
