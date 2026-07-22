import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../tools/registry/registry.js'
import {
  AgentRuntimeHooks,
  registerAgentRuntimeExtension,
  runWithAgentRuntimeHooks,
  type AgentRuntimeEvent,
} from './runtime-hooks.js'

const context = { runId: 'run-1', conversationId: 'conversation-1' }

describe('AgentRuntimeHooks', () => {
  it('delivers ordered events and isolates extension failures', async () => {
    const received: AgentRuntimeEvent[] = []
    const onExtensionError = vi.fn()
    const hooks = new AgentRuntimeHooks(context, [
      {
        name: 'broken-observer',
        onEvent: () => {
          throw new Error('observer unavailable')
        },
      },
      {
        name: 'collector',
        onEvent: (event) => {
          received.push(event)
        },
      },
    ], onExtensionError)

    await hooks.emit('step.started', {
      stepIndex: 0,
      messageCount: 1,
      toolCount: 2,
      forcingFinalResponse: false,
    })
    await hooks.emit('step.committed', {
      stepIndex: 0,
      nextStepIndex: 1,
      messageCount: 3,
    })

    expect(received.map(event => [event.sequence, event.type])).toEqual([
      [0, 'step.started'],
      [1, 'step.committed'],
    ])
    expect(onExtensionError).toHaveBeenCalledTimes(2)
  })

  it('uses a snapshot of global extensions for each run', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerAgentRuntimeExtension({ name: 'first', onEvent: first })
    const firstRun = new AgentRuntimeHooks(context)
    unregisterFirst()
    const unregisterSecond = registerAgentRuntimeExtension({ name: 'second', onEvent: second })
    const secondRun = new AgentRuntimeHooks(context)

    await firstRun.emit('loop.aborted', { reason: 'abort-signal', stepIndex: 0 })
    await secondRun.emit('loop.aborted', { reason: 'abort-signal', stepIndex: 0 })
    unregisterSecond()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('makes the same hook bus available to nested ToolRegistry execution', async () => {
    const events: AgentRuntimeEvent[] = []
    const hooks = new AgentRuntimeHooks(context, [{
      name: 'collector',
      onEvent: event => {
        events.push(event)
      },
    }])
    const registry = new ToolRegistry()
    registry.register({
      name: 'echo',
      description: 'echo input',
      parameters: { type: 'object' },
      isConcurrencySafe: true,
      execute: async input => input.value,
    })
    const tool = registry.toAISDKFormat().echo as {
      execute: (input: unknown, options?: { toolCallId?: string }) => Promise<unknown>
    }

    const output = await runWithAgentRuntimeHooks(hooks, () => (
      tool.execute({ value: 'ok' }, { toolCallId: 'call-1' })
    ))

    expect(output).toBe('ok')
    expect(events.map(event => event.type)).toEqual(['tool.started', 'tool.completed'])
    expect(events[0]).toMatchObject({
      data: { toolName: 'echo', toolCallId: 'call-1', concurrency: 'shared' },
    })
  })

  it('lets a per-run extension replace a global extension with the same name', async () => {
    const global = vi.fn()
    const local = vi.fn()
    const unregister = registerAgentRuntimeExtension({ name: 'audit', onEvent: global })
    const hooks = new AgentRuntimeHooks(context, [{ name: 'audit', onEvent: local }])

    await hooks.emit('approval.resolved', {
      request: { type: 'write', path: '/tmp/example' },
      approved: true,
    })
    unregister()

    expect(global).not.toHaveBeenCalled()
    expect(local).toHaveBeenCalledOnce()
  })
})
