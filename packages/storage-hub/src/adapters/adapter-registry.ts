import type { AgentAdapter } from './types'

const SAFE_ADAPTER_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export class AdapterRegistry {
  readonly #adapters = new Map<string, AgentAdapter>()

  constructor(adapters: readonly AgentAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter)
  }

  register(adapter: AgentAdapter): void {
    // Registration is an internal composition boundary for trusted first-party
    // built-ins; accepting dynamically supplied executable adapters is unsupported.
    if (!SAFE_ADAPTER_ID.test(adapter.id) || adapter.id.includes('\0')) throw new Error(`Unsafe adapter id: ${JSON.stringify(adapter.id)}`)
    if (this.#adapters.has(adapter.id)) throw new Error(`Duplicate adapter id: ${adapter.id}`)
    this.#adapters.set(adapter.id, adapter)
  }

  require(id: string): AgentAdapter {
    const adapter = this.#adapters.get(id)
    if (!adapter) throw new Error(`Unknown adapter id: ${id}`)
    return adapter
  }

  list(): readonly AgentAdapter[] {
    return Object.freeze([...this.#adapters.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  }
}
