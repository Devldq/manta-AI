export interface PendingApproval {
  id: string
  type: 'read' | 'write' | 'shell'
  path?: string
  command?: string
  requestedBy: string
  createdAt: number
  expiresAt?: number
  timeoutAction?: 'deny'
}

export function mergePendingApproval(
  approvals: PendingApproval[],
  incoming: PendingApproval,
): PendingApproval[] {
  const existingIndex = approvals.findIndex((approval) => approval.id === incoming.id)
  if (existingIndex < 0) return [...approvals, incoming]

  const updated = [...approvals]
  updated[existingIndex] = incoming
  return updated
}

export function removePendingApproval(
  approvals: PendingApproval[],
  requestId: string,
): PendingApproval[] {
  return approvals.filter((approval) => approval.id !== requestId)
}

export function replacePendingApprovals(
  approvals: PendingApproval[],
): PendingApproval[] {
  const unique = new Map<string, PendingApproval>()
  for (const approval of approvals) unique.set(approval.id, approval)
  return Array.from(unique.values())
}
