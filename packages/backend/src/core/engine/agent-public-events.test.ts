import { describe, expect, it, vi } from 'vitest'
import type { AgentPublicEvent, AgentRunSnapshot, AgentRunUsage } from '@manta/contracts'
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
      publicReason: '配置入口已经定位，读取文件可以确认当前值。',
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
    expect(events.filter(event => event.type === 'progress.committed')).toHaveLength(2)
    expect(projector.getSnapshot().steps[0].progressText).toBe(
      '正在检查配置。\n配置入口已经定位，读取文件可以确认当前值。',
    )
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

  it('continues a durable snapshot without dropping steps from a prior attempt', async () => {
    const events: AgentPublicEvent[] = []
    const initial: AgentRunSnapshot = {
      schemaVersion: 1,
      runId: 'run-resumed',
      conversationId: 'conversation-1',
      messageId: 'assistant-resumed',
      status: 'running',
      phase: 'executing',
      lastSeq: 40,
      startedAt: '2026-07-23T03:00:00.000Z',
      steps: [{
        stepIndex: 0,
        status: 'completed',
        startedAt: '2026-07-23T03:00:01.000Z',
        completedAt: '2026-07-23T03:00:02.000Z',
        progressText: '正在定位入口。',
        tools: [{
          toolCallId: 'call-old',
          toolName: 'grep',
          status: 'completed',
        }],
      }],
    }
    const projector = new AgentPublicEventProjector(
      { runId: 'run-resumed', conversationId: 'conversation-1', messageId: 'assistant-resumed' },
      event => { events.push(event) },
      initial,
    )
    const hooks = new AgentRuntimeHooks({ runId: 'run-resumed' }, [projector.extension])

    await hooks.emit('loop.started', {
      resumed: true,
      messageCount: 3,
      model: 'test-model',
      provider: 'test-provider',
      maxSteps: 10,
      maxOutputTokens: 1_000,
    })
    await hooks.emit('step.started', {
      stepIndex: 1,
      messageCount: 4,
      toolCount: 1,
      forcingFinalResponse: false,
    })
    await hooks.emit('step.progress', { stepIndex: 1, text: '正在读取配置。' })

    const snapshot = projector.getSnapshot()
    expect(snapshot.steps.map(step => step.stepIndex)).toEqual([0, 1])
    expect(snapshot.steps[0].progressText).toBe('正在定位入口。')
    expect(snapshot.steps[1].progressText).toBe('正在读取配置。')
    expect(events[0].seq).toBeGreaterThan(40)
  })
})
