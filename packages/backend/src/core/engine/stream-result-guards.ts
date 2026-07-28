/**
 * AI SDK rejects these lazy result promises when a stream is aborted before
 * producing its first completed step. The Agent loop consumes fullStream
 * directly, so attach rejection handlers up front to keep a normal user
 * cancellation from becoming an unhandled process-level rejection.
 */
export function guardStreamResultPromises(result: {
  steps: PromiseLike<unknown>
  finishReason: PromiseLike<unknown>
  rawFinishReason: PromiseLike<unknown>
  totalUsage: PromiseLike<unknown>
}): void {
  for (const pending of [
    result.steps,
    result.finishReason,
    result.rawFinishReason,
    result.totalUsage,
  ]) {
    void Promise.resolve(pending).catch(() => undefined)
  }
}
