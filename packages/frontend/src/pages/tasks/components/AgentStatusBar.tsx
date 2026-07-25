import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentRunSnapshot } from '@manta/contracts'
import { CircleStop, ListChecks, Loader2, MessageCircle, ShieldQuestion } from 'lucide-react'
import { formatAgentRunDuration, isAgentRunTerminal } from '../runtime/agent-run-view'

type AgentStatusTone = 'active' | 'waiting' | 'stale' | 'stopping'

export interface AgentStatusPresentation {
  label: string
  detail: string
  activity: string
  tone: AgentStatusTone
  icon: 'working' | 'approval' | 'input' | 'summary' | 'stopping'
}

function latestRunningTool(agentRun: AgentRunSnapshot | undefined): string | undefined {
  for (const step of [...(agentRun?.steps ?? [])].reverse()) {
    const tool = [...step.tools].reverse().find(candidate => candidate.status === 'running')
    if (tool) return tool.toolName
  }
  return undefined
}

function formatQuietDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000))
  if (seconds < 8) return '刚刚有进展'
  if (seconds < 60) return `${seconds} 秒无新事件`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes} 分${remainder > 0 ? ` ${remainder} 秒` : ''}无新事件`
}

export function getAgentStatusPresentation({
  agentRun,
  awaitingAssistant,
  reconnecting,
  now,
  lastActivityAt,
}: {
  agentRun?: AgentRunSnapshot
  awaitingAssistant: boolean
  reconnecting: boolean
  now: number
  lastActivityAt: number
}): AgentStatusPresentation {
  const quietMs = Math.max(0, now - lastActivityAt)
  const stale = quietMs >= 90_000

  if (reconnecting) {
    return {
      label: 'Agent 正在恢复连接',
      detail: '任务仍由 Service 执行',
      activity: formatQuietDuration(quietMs),
      tone: stale ? 'stale' : 'active',
      icon: 'working',
    }
  }

  if (!agentRun) {
    return {
      label: 'Agent 正在准备',
      detail: awaitingAssistant ? '正在启动本轮任务' : '正在连接执行任务',
      activity: formatQuietDuration(quietMs),
      tone: stale ? 'stale' : 'active',
      icon: 'working',
    }
  }

  if (agentRun.status === 'cancelling' || agentRun.phase === 'cancelling') {
    return {
      label: 'Agent 正在停止',
      detail: '等待当前操作安全结束',
      activity: formatQuietDuration(quietMs),
      tone: 'stopping',
      icon: 'stopping',
    }
  }

  if (agentRun.phase === 'waiting_approval') {
    return {
      label: 'Agent 等待授权',
      detail: '需要你确认后继续',
      activity: `已等待 ${formatAgentRunDuration(quietMs) ?? '0s'}`,
      tone: 'waiting',
      icon: 'approval',
    }
  }

  if (agentRun.status === 'waiting_for_input' || agentRun.phase === 'awaiting_user') {
    return {
      label: 'Agent 等待你的回复',
      detail: '补充信息后继续执行',
      activity: `已等待 ${formatAgentRunDuration(quietMs) ?? '0s'}`,
      tone: 'waiting',
      icon: 'input',
    }
  }

  if (agentRun.phase === 'summarizing') {
    return {
      label: 'Agent 正在整理结果',
      detail: '执行已结束，正在生成任务总结',
      activity: formatQuietDuration(quietMs),
      tone: stale ? 'stale' : 'active',
      icon: 'summary',
    }
  }

  const toolName = latestRunningTool(agentRun)
  return {
    label: stale ? 'Agent 长时间未更新' : 'Agent 正在工作',
    detail: toolName
      ? `正在执行 ${toolName}`
      : agentRun.phase === 'queued'
        ? '任务正在排队'
        : '正在思考下一步',
    activity: stale ? `${formatQuietDuration(quietMs)}，可能仍在执行耗时操作` : formatQuietDuration(quietMs),
    tone: stale ? 'stale' : 'active',
    icon: 'working',
  }
}

function StatusIcon({ presentation }: { presentation: AgentStatusPresentation }) {
  switch (presentation.icon) {
    case 'approval':
      return <ShieldQuestion size={14} />
    case 'input':
      return <MessageCircle size={14} />
    case 'summary':
      return <ListChecks size={14} />
    case 'stopping':
      return <CircleStop size={14} />
    default:
      return <Loader2 size={14} className="tool-spinner" />
  }
}

export const AgentStatusBar = memo(function AgentStatusBar({
  agentRun,
  awaitingAssistant,
  reconnecting,
  lastActivityAt,
}: {
  agentRun?: AgentRunSnapshot
  awaitingAssistant: boolean
  reconnecting: boolean
  lastActivityAt?: string
}) {
  const visible = awaitingAssistant || reconnecting || Boolean(agentRun && !isAgentRunTerminal(agentRun))
  const mountedAtRef = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  const parsedActivityAt = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN
  const activityAt = Number.isFinite(parsedActivityAt) ? parsedActivityAt : mountedAtRef.current

  useEffect(() => {
    if (!visible) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [visible])

  const presentation = useMemo(() => getAgentStatusPresentation({
    agentRun,
    awaitingAssistant,
    reconnecting,
    now,
    lastActivityAt: activityAt,
  }), [activityAt, agentRun, awaitingAssistant, now, reconnecting])

  if (!visible) return null

  return (
    <div
      className={`agent-status-bar is-${presentation.tone}`}
      role="status"
      aria-live="polite"
      aria-label={`${presentation.label}，${presentation.detail}，${presentation.activity}`}
    >
      <span className="agent-status-icon" aria-hidden="true">
        <StatusIcon presentation={presentation} />
      </span>
      <span className="agent-status-label">{presentation.label}</span>
      <span className="agent-status-separator" aria-hidden="true" />
      <span className="agent-status-detail">{presentation.detail}</span>
      <span className="agent-status-activity">{presentation.activity}</span>
    </div>
  )
})

