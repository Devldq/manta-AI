import { getSecurityContext, type SecurityApprovalRequest } from '../security-context.js'
import { approvalManager } from './ApprovalManager.js'
import { getAgentRuntimeHooks } from '../engine/runtime-hooks.js'
import { getApprovalPolicy, shouldRequestApproval } from './approval-policy.js'

/**
 * One approval boundary for every built-in tool. Durable Agent Jobs inject a
 * Job-backed implementation through SecurityContext; legacy callers retain
 * the existing in-process ApprovalManager behaviour.
 */
export async function requestToolApproval(request: SecurityApprovalRequest, timeoutMs?: number): Promise<boolean> {
  const context = getSecurityContext()
  const runtimeHooks = getAgentRuntimeHooks()
  const approvalMode = context?.approvalMode ?? 'request'
  const effectiveTimeoutMs = timeoutMs
    ?? context?.approvalTimeoutMs
    ?? getApprovalPolicy().timeoutMs

  if (!shouldRequestApproval(approvalMode, request)) return true

  await runtimeHooks?.emit('approval.requested', { request })

  let approved: boolean
  try {
    approved = context?.onApprovalRequest
      ? await context.onApprovalRequest(request)
      : await approvalManager.waitForResponse(
          approvalManager.createRequest(
            request.type,
            context?.taskId ?? 'unknown',
            request.path,
            request.command,
            undefined,
            effectiveTimeoutMs,
          ),
          effectiveTimeoutMs,
        )
  } catch (error) {
    await runtimeHooks?.emit('approval.failed', {
      request,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  await runtimeHooks?.emit('approval.resolved', { request, approved })
  return approved
}
