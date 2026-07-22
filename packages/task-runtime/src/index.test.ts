import { describe, expect, it, vi } from 'vitest'
import type { JobEvent } from '@manta/contracts'
import { TaskRuntime } from './index.js'

function event(seq: number, type: JobEvent['type']): JobEvent {
  return {
    jobId: 'job-1',
    seq,
    type,
    timestamp: '2026-07-22T10:00:00.000Z',
    data: {},
  }
}

describe('TaskRuntime.subscribeFrom', () => {
  it('buffers live events during replay and delivers one ordered exclusive cursor', () => {
    const runtime = Object.create(TaskRuntime.prototype) as TaskRuntime
    let liveListener: ((value: JobEvent) => void) | undefined
    const unsubscribe = vi.fn()
    vi.spyOn(runtime, 'subscribe').mockImplementation((_jobId, listener) => {
      liveListener = listener
      return unsubscribe
    })
    vi.spyOn(runtime, 'events').mockImplementation(() => {
      liveListener?.(event(3, 'job.cancellation_requested'))
      return [event(1, 'job.created'), event(2, 'job.started')]
    })
    const received: JobEvent[] = []

    const stop = runtime.subscribeFrom('job-1', 0, value => received.push(value))
    liveListener?.(event(2, 'job.started'))
    liveListener?.(event(4, 'job.cancelled'))
    stop()

    expect(received.map(value => [value.seq, value.type])).toEqual([
      [1, 'job.created'],
      [2, 'job.started'],
      [3, 'job.cancellation_requested'],
      [4, 'job.cancelled'],
    ])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
