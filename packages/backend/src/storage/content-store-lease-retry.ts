const DEFAULT_TIMEOUT_MS = 30_000
const RETRY_INTERVAL_MS = 20

function errorChain(error: unknown): Error[] {
  const errors: Error[] = []
  let current = error
  const seen = new Set<unknown>()
  while (current instanceof Error && !seen.has(current)) {
    errors.push(current)
    seen.add(current)
    current = current.cause
  }
  return errors
}

export function isContentStoreLeaseBusy(error: unknown): boolean {
  return errorChain(error).some((candidate) => /content-store lock (?:.*\bbusy\b|has unknown owner)/i.test(candidate.message))
}

/**
 * Sync cross-group stores participate in the same volume lease as async CAS
 * publication. An HTTP handler must yield while that async owner finishes;
 * blocking the event loop here would also block the lease release.
 */
export async function retryContentStoreLease<T>(
  operation: () => T,
  options: { timeoutMs?: number; retryIntervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      return operation()
    } catch (error) {
      if (!isContentStoreLeaseBusy(error) || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
    }
  }
}
