import { describe, expect, it, vi } from 'vitest'
import type { AgentPublicEvent, AgentRunUsage } from '@manta/contracts'
import { AgentPublicEventProjector } from './agent-public-events.js'
import { AgentRuntimeHooks } from './runtime-hooks.js'

const usage: AgentRunUsage = {
  inputTokens: 120,
  outputTokens: 30,
  totalTokens: 150,
  cacheReadTokens: 40,
  stepCount: 1,
  toolCallCount: 1,
  toolErrorCount: 0,
  durationMs: 2_500,
  completeness: 'complete',
}

describe('AgentPublicEventProjector', () => {
  it('publishes ordered, sanitized progress and persists a terminal snapshot', async () => {
    const events: AgentPublicEvent[] = []
    const projector = new AgentPublicEventProjector(
      { runId: 'run-1', conversationId: 'conversation-1', messageId: 'assistant-1' },
      event => { events.push(event) },
    )
    const hooks = new AgentRuntimeHooks({ runId: 'run-1', conversationId: 'conversation-1' }, [projector.extension])

    await hooks.emit('loop.started', {
      resumed: false,
      messageCount: 1,
      model: 'test-model',
      provider: 'test-provider',
      maxSteps: 10,
      maxOutputTokens: 1_000,
    })
    await hooks.emit('step.started', {
      stepIndex: 0,
      messageCount: 1,
      toolCount: 1,
      forcingFinalResponse: false,
    })
    await hooks.emit('step.progress', { stepIndex: 0, text: '正在检查配置。' })
    await hooks.emit('tool.started', {
      toolName: 'readFile',
      toolCallId: 'call-1',
      input: { path: '/tmp/config', authorization: 'Bearer should-not-leak' },
      source: 'builtin',
      concurrency: 'shared',
    })
    await hooks.emit('tool.completed', {
      toolName: 'readFile',
      toolCallId: 'call-1',
      durationMs: 20,
      outputChars: 12,
      truncated: false,
    })
    await hooks.emit('step.completed', {
      stepIndex: 0,
      durationMs: 30,
      textLength: 8,
      toolNames: ['readFile'],
      toolErrorCount: 0,
      finishReason: 'stop',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 40 },
    })

    const persist = vi.fn()
    await projector.finalize('检查完成。', usage, persist)

    expect(events.map(event => event.seq)).toEqual(events.map((_, index) => index + 1))
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      'run.started',
      'progress.committed',
      'tool.started',
      'tool.completed',
      'summary.completed',
      'usage.finalized',
      'run.completed',
    ]))
    const toolStarted = events.find(event => event.type === 'tool.started')
    expect(toolStarted?.data).toMatchObject({ input: { authorization: '[已脱敏]' } })
    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0][0]).toMatchObject({
      status: 'completed',
      phase: 'completed',
      summaryMarkdown: '检查完成。',
      usage: { totalTokens: 150, cacheReadTokens: 40 },
    })
  })

  it('emits summary.started only once when forced synthesis was already announced', async () => {
    const events: AgentPublicEvent[] = []
    const projector = new AgentPublicEventProjector(
      { runId: 'run-2', conversationId: 'conversation-1', messageId: 'assistant-2' },
      event => { events.push(event) },
    )
    const hooks = new AgentRuntimeHooks({ runId: 'run-2' }, [projector.extension])

    await hooks.emit('step.started', {
      stepIndex: 1,
      messageCount: 2,
      toolCount: 0,
      forcingFinalResponse: true,
    })
    await projector.finalize('总结。', usage)

    expect(events.filter(event => event.type === 'summary.started')).toHaveLength(1)
  })
})
