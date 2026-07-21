import { describe, expect, it, vi } from 'vitest'
import { isContentStoreLeaseBusy, retryContentStoreLease } from './content-store-lease-retry'

describe('content-store lease retry', () => {
  it('yields and retries a busy sync store operation', async () => {
    const operation = vi.fn()
      .mockImplementationOnce(() => { throw new Error('Content-store lock lease is busy') })
      .mockImplementationOnce(() => { throw new Error('Content-store lock has unknown owner') })
      .mockReturnValue('ready')

    await expect(retryContentStoreLease(operation, { timeoutMs: 100, retryIntervalMs: 1 })).resolves.toBe('ready')
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('does not retry unrelated failures', async () => {
    const operation = vi.fn(() => { throw new Error('invalid knowledge base') })

    await expect(retryContentStoreLease(operation, { timeoutMs: 100, retryIntervalMs: 1 })).rejects.toThrow('invalid knowledge base')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('recognizes a busy lease wrapped as an error cause', () => {
    const error = new Error('cross-group read failed', { cause: new Error('Content-store lock lease is busy or stale') })
    expect(isContentStoreLeaseBusy(error)).toBe(true)
  })
})
