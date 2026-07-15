import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeStorage } from './desktop-storage-bridge'

describe('desktop storage bridge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves a typed Git binding conflict so the volume card can clear loading and show the error', async () => {
    vi.stubGlobal('window', { mantaDesktop: { storage: { invoke: async () => ({ ok: false, error: { code: 'GIT_BINDING_CONFLICT', message: 'Volume v1 already has a local Git binding' } }), subscribeProgress: () => () => {} } } })

    await expect(invokeStorage({ channel: 'storage:configure-git', volumeId: 'v1', mode: 'remote', remoteUrl: 'https://example.test/ash.git' })).rejects.toMatchObject({ code: 'GIT_BINDING_CONFLICT', message: 'Volume v1 already has a local Git binding' })
  })
})
