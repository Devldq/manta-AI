import type { TaskRuntime } from '@manta/task-runtime'
import { approvalManager, type ApprovalRequest } from '../core/security/ApprovalManager.js'

const TYPES = new Set<ApprovalRequest['type']>(['read', 'write', 'shell'])

/** Rebuild the compatibility approval view from durable waiting Agent Jobs. */
export function hydrateDurableApprovals(runtime: TaskRuntime | undefined): void {
  if (!runtime) return
  const waiting = runtime.listJobs({ kind: 'agent.run', status: 'waiting_for_input', limit: 200 })
  const waitingIds = new Set(waiting.map((job) => job.id))
  for (const request of approvalManager.getPendingRequests()) {
    // Once a durable Job leaves waiting_for_input there is no waiter that can
    // consume a late decision. Resolve instead of deleting so SSE clients
    // receive the terminal event.
    if (request.durable && !waitingIds.has(request.requestedBy)) {
      approvalManager.respondToRequest(request.id, 'deny')
    }
  }
  for (const job of waiting) {
    const event = runtime.events(job.id, 0, 5_000).reverse().find((candidate) => candidate.type === 'job.waiting_for_input')
    const request = objectValue(objectValue(event?.data)?.request)
    const id = stringValue(request?.id)
    const type = stringValue(request?.type) as ApprovalRequest['type'] | undefined
    if (!id || !type || !TYPES.has(type)) continue
    const createdAt = numberValue(request?.createdAt) ?? Date.now()
    const expiresAt = numberValue(request?.expiresAt)
    const timeoutMs = expiresAt === undefined
      ? 60_000
      : Math.max(0, expiresAt - createdAt)
    approvalManager.createRequest(
      type,
      job.id,
      stringValue(request?.path),
      stringValue(request?.command),
      id,
      timeoutMs,
      createdAt,
    )
  }
}

export function provideDurableApprovalInput(runtime: TaskRuntime | undefined, request: ApprovalRequest, action: 'approve' | 'deny'): boolean {
  if (!runtime) return false
  const job = runtime.getJob(request.requestedBy)
  if (job?.kind !== 'agent.run' || job.status !== 'waiting_for_input') return false
  try {
    runtime.provideInput(job.id, { approvalId: request.id, decision: action })
    return true
  } catch {
    return false
  }
}

export function expirePendingApprovals(runtime: TaskRuntime | undefined, now = Date.now()): number {
  let expired = 0
  for (const request of approvalManager.getPendingRequests()) {
    if (request.expiresAt > now) continue
    if (request.durable && !provideDurableApprovalInput(runtime, request, request.timeoutAction)) {
      continue
    }
    if (approvalManager.respondToRequest(request.id, request.timeoutAction)) expired += 1
  }
  return expired
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
