/* 上下文管理面板 — 查看传给大模型的真实上下文状态
 *
 * 展示内容：
 * - System Prompt 各 Pipe 段落的 token 占用
 * - 每轮对话的上下文消息结构（角色、内容长度、是否被清理）
 * - Microcompact / Compaction 执行效果
 * - 总 Token 估算
 */
'use client'

import React, { useState, useEffect, useCallback, memo } from 'react'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileText,
  Sparkles,
  Trash2,
  User,
  Bot,
  Wrench,
  Zap,
  Layers,
  AlertTriangle,
  Scissors,
  Minimize2,
} from 'lucide-react'

// ─── 类型 ────────────────────────────────────────────────────────────────────

interface PipeSection {
  name: string
  enabled: boolean
  charCount: number
  estimatedTokens: number
  preview: string
}

interface MessageSnapshot {
  role: string
  charCount: number
  estimatedTokens: number
  cleared: boolean
  truncated: boolean
  compacted: boolean
  toolName?: string
  preview: string
}

interface StepSnapshot {
  stepIndex: number
  inputTokens: number
  outputTokens: number
  messageCount: number
  toolCallCount: number
  microcompactCleared?: number
  compactionCompressed?: number
  messages: MessageSnapshot[]
}

interface TurnData {
  turnIndex: number
  label: string
  messages: MessageSnapshot[]
}

interface ContextData {
  conversationId: string
  summary: {
    title: string
    agentName: string
    createdAt: string
    updatedAt: string
    userMsgCount: number
    assistantMsgCount: number
    toolCallCount: number
    totalInputTokens: number
    totalOutputTokens: number
    totalMessages: number
  }
  systemPrompt: {
    totalChars: number
    totalEstimatedTokens: number
    pipes: PipeSection[]
  }
  steps: StepSnapshot[]
  perTurn: TurnData[]
  compactionSummary?: string
  totalEstimatedTokens: number
}

// ─── 角色图标 & 颜色 ────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { icon: typeof User; color: string; bg: string; label: string }> = {
  user: { icon: User, color: 'text-blue-400', bg: 'bg-blue-500/10', label: '用户' },
  assistant: { icon: Bot, color: 'text-green-400', bg: 'bg-green-500/10', label: '助手' },
  tool: { icon: Wrench, color: 'text-amber-400', bg: 'bg-amber-500/10', label: '工具' },
  system: { icon: Zap, color: 'text-purple-400', bg: 'bg-purple-500/10', label: '系统' },
}

const PIPE_LABELS: Record<string, string> = {
  coreRules: '核心规则',
  toolGuide: '工具指南',
  workingDirectory: '工作目录',
  deferredTools: '延迟工具',
  agentSoul: 'Agent Soul',
  sessionContext: '会话上下文',
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

interface ContextViewProps {
  taskId?: string
}

export const ContextView = memo(function ContextView({ taskId }: ContextViewProps) {
  const [data, setData] = useState<ContextData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPipe, setExpandedPipe] = useState<string | null>(null)
  const [expandedTurn, setExpandedTurn] = useState<number | null>(null)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)

  const fetchContext = useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/context`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    fetchContext()
  }, [fetchContext])

  // 自动轮询（5s 间隔，仅会话活跃时）
  useEffect(() => {
    const timer = setInterval(fetchContext, 5000)
    return () => clearInterval(timer)
  }, [fetchContext])

  if (!taskId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <Brain size={32} className="text-text-muted mb-3 opacity-50" />
        <p className="text-sm text-text-muted">暂无上下文信息</p>
        <p className="text-xs text-text-muted mt-1">开始对话后将显示上下文状态</p>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={20} className="text-text-muted animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <AlertTriangle size={32} className="text-status-failed mb-3" />
        <p className="text-sm text-text-muted">加载上下文失败</p>
        <p className="text-xs text-text-muted mt-1">{error}</p>
        <button onClick={fetchContext} className="mt-3 text-xs text-accent hover:underline">重试</button>
      </div>
    )
  }

  if (!data) return null

  const { summary, systemPrompt, perTurn, steps } = data

  return (
    <div className="h-full overflow-y-auto">
      {/* Token 总览 */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-primary">上下文总览</h3>
          <button onClick={fetchContext} className="text-text-muted hover:text-text-secondary transition-colors" title="刷新">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <TokenCard label="System Prompt" tokens={systemPrompt.totalEstimatedTokens} icon={Layers} />
          <TokenCard label="输入 Token" tokens={summary.totalInputTokens} icon={FileText} />
          <TokenCard label="输出 Token" tokens={summary.totalOutputTokens} icon={Bot} />
        </div>
        {data.compactionSummary && (
          <div className="mt-2 px-2 py-1.5 rounded-md bg-accent/5 border border-accent/20 text-[11px] text-accent flex items-center gap-1.5">
            <Sparkles size={12} />
            {data.compactionSummary}
          </div>
        )}
      </div>

      {/* System Prompt 各 Pipe */}
      {systemPrompt.pipes.length > 0 && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2">System Prompt ({systemPrompt.pipes.filter(p => p.enabled).length}/{systemPrompt.pipes.length} 段落)</h3>
          <div className="space-y-1">
            {systemPrompt.pipes.map(pipe => (
              <div key={pipe.name}>
                <button
                  className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface/80 transition-colors text-left"
                  onClick={() => setExpandedPipe(expandedPipe === pipe.name ? null : pipe.name)}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${pipe.enabled ? 'bg-status-done' : 'bg-text-muted/30'}`} />
                  <span className="text-xs font-medium text-text-secondary flex-1">
                    {PIPE_LABELS[pipe.name] ?? pipe.name}
                  </span>
                  <span className="text-[10px] text-text-muted font-mono">
                    {pipe.enabled ? `~${pipe.estimatedTokens}t` : 'OFF'}
                  </span>
                  {pipe.enabled && pipe.preview && (
                    expandedPipe === pipe.name
                      ? <ChevronDown size={12} className="text-text-muted" />
                      : <ChevronRight size={12} className="text-text-muted" />
                  )}
                </button>
                {expandedPipe === pipe.name && pipe.preview && (
                  <div className="ml-4 mr-2 mt-0.5 mb-1 p-2 rounded bg-surface/60 border border-border-subtle">
                    <pre className="text-[10px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {pipe.preview}{pipe.charCount > 200 ? '\n…' : ''}
                    </pre>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-text-muted">
                      <span>{pipe.charCount} 字符</span>
                      <span>~{pipe.estimatedTokens} tokens</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Loop 步骤摘要（来自日志） */}
      {steps.length > 0 && (
        <div className="px-4 py-3 border-b border-border-subtle">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Agent 步骤 ({steps.length} 步)</h3>
          <div className="space-y-1">
            {steps.map(step => {
              const hasMessages = step.messages.length > 0
              const totalStepTokens = step.messages.reduce((s, m) => s + m.estimatedTokens, 0)
              const clearedCount = step.messages.filter(m => m.cleared).length
              const truncatedCount = step.messages.filter(m => m.truncated).length
              const compactedCount = step.messages.filter(m => m.compacted).length
              return (
                <div key={step.stepIndex}>
                  <button
                    className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors text-left ${
                      hasMessages ? 'hover:bg-surface/80 cursor-pointer' : 'bg-surface/40'
                    }`}
                    onClick={() => hasMessages && setExpandedStep(expandedStep === step.stepIndex ? null : step.stepIndex)}
                    disabled={!hasMessages}
                  >
                    {hasMessages && (
                      expandedStep === step.stepIndex
                        ? <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
                        : <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
                    )}
                    <span className="text-[10px] text-text-muted font-mono w-8 flex-shrink-0">#{step.stepIndex + 1}</span>
                    <span className="text-xs text-text-secondary flex-1">
                      {step.messageCount} 条消息 · {step.toolCallCount} 工具
                      {totalStepTokens > 0 && (
                        <span className="text-[10px] text-text-muted ml-1">~{totalStepTokens.toLocaleString()}t</span>
                      )}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono flex-shrink-0">
                      {step.inputTokens > 0 ? `${step.inputTokens.toLocaleString()}in` : ''}
                      {step.outputTokens > 0 ? ` ${step.outputTokens.toLocaleString()}out` : ''}
                    </span>
                    {step.microcompactCleared !== undefined && step.microcompactCleared > 0 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 flex-shrink-0" title="Microcompact 清理">
                        🧹{step.microcompactCleared}
                      </span>
                    )}
                    {step.compactionCompressed !== undefined && step.compactionCompressed > 0 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 flex-shrink-0" title="Compaction 压缩">
                        ✨{step.compactionCompressed}
                      </span>
                    )}
                    {truncatedCount > 0 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 flex-shrink-0 flex items-center gap-0.5" title="动态截断 (Head/Tail)">
                        <Scissors size={8} />{truncatedCount}
                      </span>
                    )}
                    {compactedCount > 0 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 flex-shrink-0 flex items-center gap-0.5" title="上下文预算清理">
                        <Minimize2 size={8} />{compactedCount}
                      </span>
                    )}
                    {clearedCount > 0 && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 flex-shrink-0 flex items-center gap-0.5">
                        <Trash2 size={8} />{clearedCount}
                      </span>
                    )}
                  </button>
                  {/* 展开的消息详情 */}
                  {expandedStep === step.stepIndex && hasMessages && (
                    <div className="ml-6 mr-2 mt-0.5 mb-1 space-y-0.5">
                      {/* 步骤统计条 */}
                      <div className="flex items-center gap-3 px-2 py-1 text-[10px] text-text-muted">
                        <span>{step.messages.length} 条消息</span>
                        <span>~{totalStepTokens.toLocaleString()} tokens</span>
                        <span className="capitalize">
                          {Object.entries(
                            step.messages.reduce((acc, m) => {
                              acc[m.role] = (acc[m.role] || 0) + 1
                              return acc
                            }, {} as Record<string, number>)
                          ).map(([role, count]) => `${role}:${count}`).join(' ')}
                        </span>
                        {truncatedCount > 0 && (
                          <span className="text-blue-400">{truncatedCount} 已截断</span>
                        )}
                        {compactedCount > 0 && (
                          <span className="text-orange-400">{compactedCount} 已压缩</span>
                        )}
                        {clearedCount > 0 && (
                          <span className="text-red-400">{clearedCount} 已清理</span>
                        )}
                      </div>
                      {/* 消息列表 */}
                      {step.messages.map((msg, idx) => {
                        const config = ROLE_CONFIG[msg.role] ?? ROLE_CONFIG.system
                        const Icon = config.icon
                        return (
                          <div key={idx} className={`flex items-start gap-2 py-1.5 px-2 rounded ${msg.cleared ? 'bg-red-500/5 border border-red-500/10' : 'bg-surface/40'}`}>
                            <Icon size={12} className={`${config.color} flex-shrink-0 mt-0.5`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] font-medium ${config.color}`}>{config.label}</span>
                                {msg.toolName && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-amber-500/10 text-amber-500 font-mono">
                                    {msg.toolName}
                                  </span>
                                )}
                                {msg.cleared && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-red-500/10 text-red-400 flex items-center gap-0.5">
                                    <Trash2 size={8} /> 已清理
                                  </span>
                                )}
                                {msg.truncated && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-blue-500/10 text-blue-400 flex items-center gap-0.5" title="动态截断 (Head/Tail)">
                                    <Scissors size={8} /> 已截断
                                  </span>
                                )}
                                {msg.compacted && (
                                  <span className="text-[10px] px-1 py-0 rounded bg-orange-500/10 text-orange-400 flex items-center gap-0.5" title="上下文预算清理">
                                    <Minimize2 size={8} /> 已压缩
                                  </span>
                                )}
                              </div>
                              <p className={`text-[10px] mt-0.5 whitespace-pre-wrap break-all max-h-32 overflow-y-auto ${
                                msg.cleared ? 'text-text-muted/50 line-through' : 'text-text-muted'
                              }`}>
                                {msg.preview}
                              </p>
                            </div>
                            <span className="text-[10px] text-text-muted font-mono flex-shrink-0">
                              {msg.estimatedTokens}t
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 每轮对话的消息结构 */}
      {perTurn.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="text-sm font-semibold text-text-primary mb-2">对话上下文 ({perTurn.length} 轮)</h3>
          <div className="space-y-1.5">
            {perTurn.map(turn => (
              <div key={turn.turnIndex}>
                <button
                  className="w-full flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface/80 transition-colors text-left"
                  onClick={() => setExpandedTurn(expandedTurn === turn.turnIndex ? null : turn.turnIndex)}
                >
                  {expandedTurn === turn.turnIndex
                    ? <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
                    : <ChevronRight size={12} className="text-text-muted flex-shrink-0" />
                  }
                  <span className="text-xs text-text-secondary flex-1 truncate">
                    Turn {turn.turnIndex + 1}: {turn.label}
                  </span>
                  <span className="text-[10px] text-text-muted font-mono flex-shrink-0">
                    {turn.messages.length}msg · ~{turn.messages.reduce((s, m) => s + m.estimatedTokens, 0)}t
                  </span>
                </button>
                {expandedTurn === turn.turnIndex && (
                  <div className="ml-4 mr-2 mt-0.5 space-y-0.5">
                    {turn.messages.map((msg, idx) => {
                      const config = ROLE_CONFIG[msg.role] ?? ROLE_CONFIG.system
                      const Icon = config.icon
                      return (
                        <div key={idx} className="flex items-start gap-2 py-1 px-2 rounded bg-surface/40">
                          <Icon size={12} className={`${config.color} flex-shrink-0 mt-0.5`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-medium ${config.color}`}>{config.label}</span>
                              {msg.toolName && (
                                <span className="text-[10px] px-1 py-0 rounded bg-amber-500/10 text-amber-500 font-mono">
                                  {msg.toolName}
                                </span>
                              )}
                              {msg.cleared && (
                                <span className="text-[10px] px-1 py-0 rounded bg-red-500/10 text-red-400 flex items-center gap-0.5">
                                  <Trash2 size={8} /> 已清理
                                </span>
                              )}
                              {msg.truncated && (
                                <span className="text-[10px] px-1 py-0 rounded bg-blue-500/10 text-blue-400 flex items-center gap-0.5" title="动态截断 (Head/Tail)">
                                  <Scissors size={8} /> 已截断
                                </span>
                              )}
                              {msg.compacted && (
                                <span className="text-[10px] px-1 py-0 rounded bg-orange-500/10 text-orange-400 flex items-center gap-0.5" title="上下文预算清理">
                                  <Minimize2 size={8} /> 已压缩
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-text-muted truncate mt-0.5">{msg.preview}</p>
                          </div>
                          <span className="text-[10px] text-text-muted font-mono flex-shrink-0">
                            {msg.estimatedTokens}t
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 空状态 */}
      {perTurn.length === 0 && steps.length === 0 && systemPrompt.pipes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Brain size={32} className="text-text-muted mb-3 opacity-50" />
          <p className="text-sm text-text-muted">上下文数据为空</p>
          <p className="text-xs text-text-muted mt-1">发送第一条消息后刷新查看</p>
        </div>
      )}
    </div>
  )
})

// ─── 辅助组件 ────────────────────────────────────────────────────────────────

function TokenCard({ label, tokens, icon: Icon }: { label: string; tokens: number; icon: typeof Brain }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-surface/50 border border-border-subtle text-center">
      <div className="flex items-center justify-center gap-1">
        <Icon size={10} className="text-text-muted" />
        <span className="text-sm font-semibold text-text-primary">{tokens > 0 ? tokens.toLocaleString() : '—'}</span>
      </div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  )
}
