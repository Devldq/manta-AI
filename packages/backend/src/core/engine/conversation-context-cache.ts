import type { PipeStats } from '@context/prompt-builder'
import type { AgentRunContextSnapshot } from './agent-run-context'

export interface CachedConversationContext {
  fingerprint: string
  runContext: AgentRunContextSnapshot
  pipeStats: PipeStats[]
  soulLength: number
}

const MAX_CACHED_CONVERSATIONS = 200
const cache = new Map<string, CachedConversationContext>()

export function getCachedConversationContext(
  conversationId: string,
  fingerprint: string,
): CachedConversationContext | null {
  const entry = cache.get(conversationId)
  if (!entry || entry.fingerprint !== fingerprint) return null
  // 触碰后移到末尾，维持简单 LRU 顺序。
  cache.delete(conversationId)
  cache.set(conversationId, entry)
  return entry
}

export function setCachedConversationContext(
  conversationId: string,
  entry: CachedConversationContext,
): void {
  cache.delete(conversationId)
  cache.set(conversationId, entry)
  while (cache.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
}

export function clearCachedConversationContext(conversationId: string): void {
  cache.delete(conversationId)
}

export function clearAllCachedConversationContexts(): void {
  cache.clear()
}
