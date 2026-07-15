import { describe, expect, it, vi } from 'vitest'
import { SelectionStore } from './SelectionStore'

describe('SelectionStore', () => {
  it('binds a one-time token to sender, top frame, origin, and purpose', () => {
    const store = new SelectionStore({ now: () => 10, ttlMs: 100 })
    const token = store.issue('C:/chosen', { senderId: 7, frameId: 3, origin: 'http://127.0.0.1:4000', purpose: 'migrateVolume' })
    expect(() => store.consume(token, { senderId: 8, frameId: 3, origin: 'http://127.0.0.1:4000', purpose: 'migrateVolume' })).toThrow('sender')
    expect(() => store.consume(token, { senderId: 7, frameId: 3, origin: 'http://127.0.0.1:4000', purpose: 'createVolume' })).toThrow('purpose')
    expect(store.consume(token, { senderId: 7, frameId: 3, origin: 'http://127.0.0.1:4000', purpose: 'migrateVolume' })).toBe('C:/chosen')
    expect(() => store.consume(token, { senderId: 7, frameId: 3, origin: 'http://127.0.0.1:4000', purpose: 'migrateVolume' })).toThrow('invalid')
  })

  it('expires tokens, caps outstanding selections, and clears a destroyed sender', () => {
    let now = 0; const store = new SelectionStore({ now: () => now, ttlMs: 5, maxEntries: 2 })
    const binding = { senderId: 1, frameId: 1, origin: 'file://', purpose: 'initialization' as const }
    const expired = store.issue('A', binding); now = 6
    expect(() => store.consume(expired, binding)).toThrow('expired')
    store.issue('B', binding); store.issue('C', binding)
    expect(() => store.issue('D', binding)).toThrow('capacity')
    store.clearSender(1); expect(store.size).toBe(0)
  })
})
