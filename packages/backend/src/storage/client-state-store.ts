import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { durableAtomicWrite } from './durable-atomic'

export interface ClientStateRecord<T = unknown> {
  version: 1
  key: string
  updatedAt: string
  value: T
}

const keyPattern = /^[a-z][a-z0-9-]{0,63}$/
const maximumPayloadBytes = 512 * 1024

/**
 * Small renderer-owned preferences are persisted only below ASH's config
 * group.  A per-key write queue prevents two renderer requests from creating
 * torn logical updates; durableAtomicWrite protects process interruption.
 */
export class ClientStateStore {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(private readonly configRoot: string | (() => string)) {}

  async get<T extends Record<string, unknown> = Record<string, unknown>>(key: string): Promise<ClientStateRecord<T> | undefined> {
    this.assertKey(key)
    const file = this.fileFor(key)
    if (!existsSync(file)) return undefined
    let parsed: unknown
    try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch { throw new Error(`Client state '${key}' is corrupt`) }
    if (!isRecord(parsed) || parsed.version !== 1 || parsed.key !== key || !('value' in parsed) || typeof parsed.updatedAt !== 'string') {
      throw new Error(`Client state '${key}' is corrupt`)
    }
    return parsed as unknown as ClientStateRecord<T>
  }

  async set<T extends Record<string, unknown>>(key: string, value: T): Promise<T> {
    this.assertKey(key)
    if (!isRecord(value)) throw new Error('Client state value must be an object')
    const encoded = JSON.stringify(value)
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maximumPayloadBytes) throw new Error(`Client state '${key}' exceeds the maximum payload size`)
    const record: ClientStateRecord<T> = { version: 1, key, updatedAt: new Date().toISOString(), value }
    const previous = this.queues.get(key) ?? Promise.resolve()
    const write = previous.catch(() => undefined).then(() => durableAtomicWrite(this.fileFor(key), JSON.stringify(record)))
    this.queues.set(key, write)
    try { await write } finally { if (this.queues.get(key) === write) this.queues.delete(key) }
    return value
  }

  async put<T extends Record<string, unknown>>(key: string, value: T): Promise<ClientStateRecord<T>> {
    await this.set(key, value)
    const record = await this.get<T>(key)
    if (!record) throw new Error(`Client state '${key}' was not written`)
    return record
  }

  private fileFor(key: string): string { return join(typeof this.configRoot === 'function' ? this.configRoot() : this.configRoot, 'client-state', `${key}.json`) }
  private assertKey(key: string): void {
    if (!keyPattern.test(key)) throw new Error('Invalid client state key')
    if (!['theme', 'sidebar', 'webhook', 'browser-import'].includes(key)) throw new Error(`Invalid client state key: ${key}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
