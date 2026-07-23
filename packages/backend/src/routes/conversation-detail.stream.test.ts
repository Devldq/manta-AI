import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { Job, JobEvent } from '@manta/contracts'
import type { TaskRuntime } from '@manta/task-runtime'
import { latestStreamingAgentJob, streamAgentJob } from './conversation-detail.js'
import {
  decideBlankFinalResponse,
  needsFinalResponseSynthesis,
} from '../core/engine/agent-loop.js'

function createStreamHarness() {
  let listener: ((event: JobEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const response = new EventEmitter() as EventEmitter & {
    writeHead: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  response.writeHead = vi.fn()
  response.write = vi.fn()
  response.end = vi.fn()

  const runtime = {
    subscribeFrom: vi.fn((_jobId: string, _afterSeq: number, next: (event: JobEvent) => void) => {
      listener = next
      return unsubscribe
    }),
    getJob: vi.fn(() => ({ id: 'job-1', status: 'running' })),
  } as unknown as TaskRuntime
  const job = { id: 'job-1', status: 'running', metadata: { conversationId: 'conversation-1' } } as unknown as Job
  const request = { raw: new EventEmitter() }
  const reply = { raw: response, hijack: vi.fn() }

  streamAgentJob(runtime, job, 0, request, reply)

  return { listener: () => listener, unsubscribe, request, response, reply }
}

describe('streamAgentJob', () => {
  it('keeps the job subscription after the POST request body closes', () => {
    const harness = createStreamHarness()

    harness.request.raw.emit('close')

    expect(harness.unsubscribe).not.toHaveBeenCalled()
    expect(harness.response.end).not.toHaveBeenCalled()

    harness.listener()?.({
      jobId: 'job-1',
      seq: 1,
      type: 'job.succeeded',
      timestamp: new Date().toISOString(),
      data: { result: null },
    })

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(harness.response.end).toHaveBeenCalledOnce()
  })

  it('detaches the job subscription when the response stream closes', () => {
    const harness = createStreamHarness()

    harness.response.emit('close')

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('projects cancellation from TaskRuntime before the job becomes terminal', () => {
    const harness = createStreamHarness()
    harness.listener()?.({
      jobId: 'job-1',
      seq: 4,
      type: 'job.cancellation_requested',
      timestamp: '2026-07-22T10:00:00.000Z',
      data: {},
    })

    const payload = String(harness.response.write.mock.calls[0][0])
    expect(payload).toContain('data-agent-run')
    expect(payload).toContain('run.cancellation_requested')
    expect(payload).toContain('cancelling')
    expect(harness.response.end).not.toHaveBeenCalled()
  })
})

describe('latestStreamingAgentJob', () => {
  it('queries only jobs that can still produce stream chunks', () => {
    const running = {
      id: 'job-running',
      status: 'running',
      metadata: { conversationId: 'conversation-1' },
    } as unknown as Job
    const listJobs = vi.fn(() => [running])
    const runtime = { listJobs } as unknown as TaskRuntime

    expect(latestStreamingAgentJob(runtime, 'conversation-1')).toBe(running)
    expect(listJobs).toHaveBeenCalledWith({
      kind: 'agent.run',
      status: ['queued', 'running', 'retry_scheduled', 'cancelling'],
      limit: 100,
    })
  })

  it('does not reconnect a conversation when no streaming job exists', () => {
    const runtime = { listJobs: vi.fn(() => []) } as unknown as TaskRuntime

    expect(latestStreamingAgentJob(runtime, 'conversation-1')).toBeUndefined()
  })
})

describe('blank final response guard', () => {
  it('retries whitespace once and then fails instead of accepting a blank success', () => {
    expect(decideBlankFinalResponse('\n', 0, 0)).toBe('retry')
    expect(decideBlankFinalResponse('   ', 0, 1)).toBe('fail')
  })

  it('accepts real text and leaves tool steps running', () => {
    expect(decideBlankFinalResponse('完整答复', 0, 0)).toBe('not-blank')
    expect(decideBlankFinalResponse('', 1, 0)).toBe('not-blank')
  })

  it('forces synthesis when an execution boundary lands on a tool or blank step', () => {
    expect(needsFinalResponseSynthesis('过程文字', 1)).toBe(true)
    expect(needsFinalResponseSynthesis('\n', 0)).toBe(true)
    expect(needsFinalResponseSynthesis('最终答复', 0)).toBe(false)
  })
})
