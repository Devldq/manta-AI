import { randomUUID } from 'node:crypto'

export type SelectionPurpose = 'initialization' | 'createVolume' | 'migrateVolume'
export interface SelectionBinding { senderId: number; frameId: number; origin: string; purpose: SelectionPurpose }
interface SelectionRecord extends SelectionBinding { path: string; createdAt: number }

export class SelectionStore {
  private readonly entries = new Map<string, SelectionRecord>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxEntries: number
  constructor(options: { now?: () => number; ttlMs?: number; maxEntries?: number } = {}) { this.now = options.now ?? Date.now; this.ttlMs = options.ttlMs ?? 5 * 60_000; this.maxEntries = options.maxEntries ?? 32 }
  get size(): number { return this.entries.size }
  issue(path: string, binding: SelectionBinding): string { this.prune(); if (this.entries.size >= this.maxEntries) throw new Error('Selection capacity exceeded'); const token = randomUUID(); this.entries.set(token, { ...binding, path, createdAt: this.now() }); return token }
  consume(token: string, binding: SelectionBinding): string {
    const record = this.entries.get(token); if (!record) throw new Error('Directory selection is invalid or was already consumed')
    if (this.now() - record.createdAt > this.ttlMs) { this.entries.delete(token); throw new Error('Directory selection expired') }
    if (record.senderId !== binding.senderId || record.frameId !== binding.frameId || record.origin !== binding.origin) throw new Error('Directory selection sender does not match')
    if (record.purpose !== binding.purpose) throw new Error('Directory selection purpose does not match')
    this.entries.delete(token); return record.path
  }
  peek(token: string, binding: SelectionBinding): string {
    const record = this.entries.get(token); if (!record) throw new Error('Directory selection is invalid or was already consumed')
    if (this.now() - record.createdAt > this.ttlMs) { this.entries.delete(token); throw new Error('Directory selection expired') }
    if (record.senderId !== binding.senderId || record.frameId !== binding.frameId || record.origin !== binding.origin) throw new Error('Directory selection sender does not match')
    if (record.purpose !== binding.purpose) throw new Error('Directory selection purpose does not match')
    return record.path
  }
  clearSender(senderId: number): void { for (const [token, record] of this.entries) if (record.senderId === senderId) this.entries.delete(token) }
  private prune(): void { const now = this.now(); for (const [token, record] of this.entries) if (now - record.createdAt > this.ttlMs) this.entries.delete(token) }
}
