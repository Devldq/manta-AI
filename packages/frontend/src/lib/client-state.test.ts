import { describe, expect, it, vi } from 'vitest'
import { createClientStateApi } from './client-state'

describe('client state API', () => {
  it('retains the in-memory value when backend persistence is temporarily unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const state = createClientStateApi(fetcher as any)
    await state.set('theme', { themeId: 'cli-pixel', mode: 'dark' })
    expect(state.peek('theme')).toEqual({ themeId: 'cli-pixel', mode: 'dark' })
  })

  it('loads canonical ASH state and ignores malformed responses', async () => {
    const state = createClientStateApi(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { version: 1, key: 'sidebar', value: { mode: 'workspace' } } }) }) as any)
    await expect(state.load('sidebar')).resolves.toEqual({ mode: 'workspace' })
    const malformed = createClientStateApi(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { value: 'bad' } }) }) as any)
    await expect(malformed.load('sidebar')).resolves.toBeUndefined()
  })
})
