import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentRunSnapshot } from '@manta/contracts'
import { AgentStatusBar, getAgentStatusPresentation } from './components/AgentStatusBar'
import { getAgentRunLastActivityAt } from './runtime/agent-run-view'

const running: AgentRunSnapshot = {
  schemaVersion: 1,
  runId: 'run-1',
  conversationId: 'conversation-1',
  messageId: 'assistant-1',
  status: 'running',
  phase: 'executing',
  lastSeq: 4,
  startedAt: '2026-07-23T04:00:00.000Z',
  steps: [{
    stepIndex: 0,
    status: 'running',
    startedAt: '2026-07-23T04:00:01.000Z',
    progressText: '正在核对实现。',
    tools: [{ toolCallId: 'read-1', toolName: 'read', status: 'running' }],
  }],
}

describe('AgentStatusBar', () => {
  it('shows the active tool and recent activity while the Agent is working', () => {
    const presentation = getAgentStatusPresentation({
      agentRun: running,
      awaitingAssistant: false,
      reconnecting: false,
      now: Date.parse('2026-07-23T04:00:05.000Z'),
      lastActivityAt: Date.parse('2026-07-23T04:00:03.000Z'),
    })

    expect(presentation).toMatchObject({
      label: 'Agent 正在工作',
      detail: '正在执行 read',
      activity: '刚刚有进展',
      tone: 'active',
    })
  })

  it('makes a long period without events visible without claiming the tool failed', () => {
    const presentation = getAgentStatusPresentation({
      agentRun: running,
      awaitingAssistant: false,
      reconnecting: false,
      now: Date.parse('2026-07-23T04:02:00.000Z'),
      lastActivityAt: Date.parse('2026-07-23T04:00:00.000Z'),
    })

    expect(presentation.label).toBe('Agent 长时间未更新')
    expect(presentation.activity).toContain('可能仍在执行耗时操作')
    expect(presentation.tone).toBe('stale')
  })

  it('renders approval as a waiting state instead of a running spinner', () => {
    const html = renderToStaticMarkup(
      <AgentStatusBar
        agentRun={{ ...running, status: 'waiting_for_input', phase: 'waiting_approval' }}
        awaitingAssistant={false}
        reconnecting={false}
        lastActivityAt={new Date().toISOString()}
      />,
    )

    expect(html).toContain('Agent 等待授权')
    expect(html).toContain('需要你确认后继续')
    expect(html).not.toContain('tool-spinner')
  })

  it('uses the latest public event timestamp as the activity boundary', () => {
    const latest = getAgentRunLastActivityAt([
      {
        type: 'data-agent-run',
        data: {
          schemaVersion: 1,
          runId: 'run-1',
          conversationId: 'conversation-1',
          messageId: 'assistant-1',
          seq: 5,
          timestamp: '2026-07-23T04:00:07.000Z',
          phase: 'executing',
          type: 'progress.committed',
          data: { text: '继续检查。' },
        },
      },
    ] as never)

    expect(latest).toBe('2026-07-23T04:00:07.000Z')
  })
})
