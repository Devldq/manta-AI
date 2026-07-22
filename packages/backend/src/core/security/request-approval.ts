import { getSecurityContext, type SecurityApprovalRequest } from '../security-context.js'
import { approvalManager } from './ApprovalManager.js'

/**
 * One approval boundary for every built-in tool. Durable Agent Jobs inject a
 * Job-backed implementation through SecurityContext; legacy callers retain
 * the existing in-process ApprovalManager behaviour.
 */
export async function requestToolApproval(request: SecurityApprovalRequest, timeoutMs = 60_000): Promise<boolean> {
  const context = getSecurityContext()
  if (context?.onApprovalRequest) return context.onApprovalRequest(request)
  const requestId = approvalManager.createRequest(request.type, context?.taskId ?? 'unknown', request.path, request.command)
  return approvalManager.waitForResponse(requestId, timeoutMs)
}
