import { describe, expect, it, vi } from 'vitest'
import { guardStreamResultPromises } from './stream-result-guards'

describe('guardStreamResultPromises', () => {
  it('observes every lazy AI SDK result rejection during cancellation', async () => {
    const rejectionHandlers = Array.from({ length: 4 }, () => vi.fn())
    const lazyResults = rejectionHandlers.map(handler => ({
      then: (
        _resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        handler(reject)
        reject?.(new Error('Job cancellation requested'))
        return Promise.resolve()
      },
    }) as unknown as PromiseLike<unknown>)

    guardStreamResultPromises({
      steps: lazyResults[0]!,
      finishReason: lazyResults[1]!,
      rawFinishReason: lazyResults[2]!,
      totalUsage: lazyResults[3]!,
    })
    await Promise.resolve()

    for (const handler of rejectionHandlers) {
      expect(handler).toHaveBeenCalledOnce()
      expect(handler.mock.calls[0]?.[0]).toEqual(expect.any(Function))
    }
  })
})
