'use client'
import { useEffect, useState } from 'react'
import { useTasksStore } from '@/store/tasksStore'
import type { Task } from '@/lib/types'
import { CheckCircle, XCircle, RefreshCw, FileText } from 'lucide-react'

/* AI start: 审批中心页面 — 展示自定义工作流中待审批的任务（需工作流包含 human_in_loop 步骤） */

export default function ApprovalPage() {
  const { tasks, loading, fetchTasks, approveTask } = useTasksStore()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [note, setNote] = useState('')

  // AI: 审批中心通过 approve API 处理（自定义工作流可扩展此逻辑）
  // 目前展示需要人工干预的任务（通用流无 PendingApproval 状态，此页用于自定义工作流）
  const pendingTasks = tasks.filter(t => (t as { status: string }).status === 'PendingApproval')

  useEffect(() => {
    fetchTasks()
    const timer = setInterval(fetchTasks, 15000)
    return () => clearInterval(timer)
  }, [fetchTasks])

  const handleApprove = async (task: Task, action: 'approve' | 'reject') => {
    setProcessingId(task.id)
    try {
      await approveTask(task.id, action, note || undefined)
      setSelectedTask(null)
      setNote('')
    } catch (e: unknown) {
      alert((e as Error).message)
    } finally {
      setProcessingId(null)
    }
  }

  return (
    <div className="flex flex-col h-screen">
      {/* AI: 顶部工具栏 */}
      <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: '#2d3148' }}>
        <div>
          <h1 className="text-lg font-bold text-white">✅ 审批中心</h1>
          <p className="text-xs mt-0.5" style={{ color: '#8892a4' }}>
            {pendingTasks.length} 个方案待审批
          </p>
        </div>
        <button
          onClick={() => fetchTasks()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
          style={{ background: '#1e2130', border: '1px solid #2d3148', color: '#a0aec0' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* AI: 左侧列表 */}
        <div className="w-72 flex-shrink-0 border-r overflow-y-auto" style={{ borderColor: '#2d3148' }}>
          {pendingTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-6">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-sm font-medium text-white">暂无待审批方案</p>
              <p className="text-xs mt-1" style={{ color: '#8892a4' }}>所有方案已处理</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {pendingTasks.map(task => (
                <div
                  key={task.id}
                  onClick={() => { setSelectedTask(task); setNote('') }}
                  className="p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: selectedTask?.id === task.id ? '#252a3a' : '#1e2130',
                    border: `1px solid ${selectedTask?.id === task.id ? '#3b82f6' : '#2d3148'}`,
                  }}
                >
                  <div className="text-sm font-medium text-white mb-1">{task.title}</div>
                  <div className="text-xs" style={{ color: '#8892a4' }}>
                    {new Date(task.updatedAt).toLocaleString('zh-CN')}
                  </div>
                  {task.workflowId && (
                    <span className="text-xs px-2 py-0.5 rounded-full mt-1.5 inline-block" style={{ background: '#0f1117', color: '#8892a4' }}>
                      {task.workflowId}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI: 右侧详情 */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedTask ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-3">📄</div>
              <p className="text-sm font-medium text-white">选择一个待审批方案</p>
              <p className="text-xs mt-1" style={{ color: '#8892a4' }}>查看待审批任务内容（适用于含审批步骤的自定义工作流）</p>
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-white mb-2">{selectedTask.title}</h2>
                {selectedTask.description && (
                  <p className="text-sm" style={{ color: '#a0aec0' }}>{selectedTask.description}</p>
                )}
              </div>

              {/* AI: 方案内容 */}
              <div className="rounded-xl p-4 mb-6" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                <div className="flex items-center gap-2 mb-3">
                  <FileText size={14} style={{ color: '#8892a4' }} />
                  <span className="text-xs font-medium" style={{ color: '#8892a4' }}>技术方案 / 待审批内容</span>
                </div>
                {selectedTask.frontendDesign ? (
                  <pre className="text-xs text-white whitespace-pre-wrap leading-relaxed">{selectedTask.frontendDesign}</pre>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm" style={{ color: '#4a5568' }}>暂无待审批内容</p>
                    <p className="text-xs mt-1" style={{ color: '#4a5568' }}>
                      需求文档: {selectedTask.requirementDoc || '未指定'}
                    </p>
                  </div>
                )}
              </div>

              {/* AI: 任务信息摘要 */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="rounded-lg p-3" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                  <div className="text-xs mb-1" style={{ color: '#8892a4' }}>工作流</div>
                  <div className="text-sm text-white">{selectedTask.workflowId || '普通任务'}</div>
                </div>
                <div className="rounded-lg p-3" style={{ background: '#1e2130', border: '1px solid #2d3148' }}>
                  <div className="text-xs mb-1" style={{ color: '#8892a4' }}>关联仓库</div>
                  <div className="text-sm text-white">{selectedTask.repos?.length || 0} 个</div>
                </div>
              </div>

              {/* AI: 审批备注 */}
              <div className="mb-4">
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#8892a4' }}>审批备注（可选）</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="通过原因或退回意见..."
                  className="w-full px-3 py-2 rounded-lg text-sm text-white resize-none"
                  style={{ background: '#0f1117', border: '1px solid #2d3148' }}
                />
              </div>

              {/* AI: 审批按钮 */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleApprove(selectedTask, 'reject')}
                  disabled={processingId === selectedTask.id}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{ background: '#2d1515', border: '1px solid #9b2c2c', color: '#fc8181' }}
                >
                  <XCircle size={16} />
                  退回重做
                </button>
                <button
                  onClick={() => handleApprove(selectedTask, 'approve')}
                  disabled={processingId === selectedTask.id}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                  style={{ background: '#1a3a2a', border: '1px solid #276749', color: '#68d391' }}
                >
                  <CheckCircle size={16} />
                  {processingId === selectedTask.id ? '处理中...' : '通过审批'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
/* AI end: 审批中心页面 */
