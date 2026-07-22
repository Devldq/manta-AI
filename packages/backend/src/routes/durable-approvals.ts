import type { TaskRuntime } from '@manta/task-runtime'
import { approvalManager, type ApprovalRequest } from '../core/security/ApprovalManager.js'

const TYPES = new Set<ApprovalRequest['type']>(['read', 'write', 'shell'])

/** Rebuild the compatibility approval view from durable waiting Agent Jobs. */
export function hydrateDurableApprovals(runtime: TaskRuntime | undefined): void {
  if (!runtime) return
  const waiting = runtime.listJobs({ kind: 'agent.run', status: 'waiting_for_input', limit: 200 })
  const waitingIds = new Set(waiting.map((job) => job.id))
  for (const request of approvalManager.getPendingRequests()) {
    const job = runtime.getJob(request.requestedBy)
    if (job?.kind === 'agent.run' && !waitingIds.has(job.id)) approvalManager.discardRequest(request.id)
  }
  for (const job of waiting) {
    const event = runtime.events(job.id, 0, 5_000).reverse().find((candidate) => candidate.type === 'job.waiting_for_input')
    const request = objectValue(objectValue(event?.data)?.request)
    const id = stringValue(request?.id)
    const type = stringValue(request?.type) as ApprovalRequest['type'] | undefined
    if (!id || !type || !TYPES.has(type)) continue
    approvalManager.createRequest(type, job.id, stringValue(request?.path), stringValue(request?.command), id)
  }
}

export function provideDurableApprovalInput(runtime: TaskRuntime | undefined, request: ApprovalRequest, action: 'approve' | 'deny'): boolean {
  if (!runtime) return false
  const job = runtime.getJob(request.requestedBy)
  if (job?.kind !== 'agent.run' || job.status !== 'waiting_for_input') return false
  runtime.provideInput(job.id, { approvalId: request.id, decision: action })
  return true
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
