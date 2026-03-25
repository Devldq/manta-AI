import type { TaskStatus } from './types'

/* AI start: 工作流状态机 — 参照 edict kanban_update.py _VALID_TRANSITIONS */

export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  Inbox: ['Architecting', 'Cancelled'],
  Architecting: ['PendingApproval', 'Blocked', 'Cancelled'],
  PendingApproval: ['Developing', 'Architecting', 'Cancelled'], // 通过 or 退回
  Developing: ['ParallelReview', 'Blocked', 'Cancelled'],
  ParallelReview: ['PendingScore', 'Blocked'],
  PendingScore: ['Done'],
  Done: [],
  Blocked: ['Architecting', 'Developing', 'Cancelled'],
  Cancelled: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export function validateTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `非法状态流转: ${from} → ${to}。允许的目标状态: [${VALID_TRANSITIONS[from]?.join(', ') || '无'}]`
    )
  }
}

/* AI end: 工作流状态机 */
