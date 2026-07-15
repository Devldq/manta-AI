export type ClientStateKey = 'theme' | 'sidebar' | 'webhook' | 'browser-import' | 'rag-batch'
type StateValue = object
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Canonical renderer preferences live in ASH through this small API. */
export function createClientStateApi(fetcher: FetchLike = fetch) {
  const memory = new Map<ClientStateKey, StateValue>()
  return {
    peek<T extends StateValue>(key: ClientStateKey): T | undefined { return memory.get(key) as T | undefined },
    async load<T extends StateValue>(key: ClientStateKey): Promise<T | undefined> {
      try {
        const response = await fetcher(`/api/storage/client-state/${key}`, { headers: { Accept: 'application/json' } })
        if (response.status === 404) return memory.get(key) as T | undefined
        const body = await response.json()
        const value = body?.success === true ? body?.data?.value : undefined
        if (!value || typeof value !== 'object' || Array.isArray(value)) return memory.get(key) as T | undefined
        memory.set(key, value as StateValue)
        return value as T
      } catch { return memory.get(key) as T | undefined }
    },
    async set<T extends StateValue>(key: ClientStateKey, value: T): Promise<boolean> {
      memory.set(key, value)
      try {
        const response = await fetcher(`/api/storage/client-state/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ value }) })
        if (!response.ok) throw new Error('Client state persistence failed')
        return true
      } catch {
        // Offline is graceful: this state is memory-only until the next retry.
      return false }
    },
  }
}

export const clientState = createClientStateApi()
