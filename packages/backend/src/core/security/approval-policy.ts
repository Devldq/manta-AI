import * as fs from 'node:fs'
import { resolveStoragePath } from '../../storage/path-routing.js'
import { durableAtomicWrite } from '../../storage/durable-atomic.js'

export const APPROVAL_MODES = ['request', 'auto', 'full'] as const
export type ApprovalMode = typeof APPROVAL_MODES[number]

export interface ApprovalPolicy {
  mode: ApprovalMode
  timeoutMs: number
}

export const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000
export const MIN_APPROVAL_TIMEOUT_MS = 5_000
export const MAX_APPROVAL_TIMEOUT_MS = 10 * 60_000

const DEFAULT_POLICY: ApprovalPolicy = {
  mode: 'request',
  timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
}
const policyFile = () => resolveStoragePath('config', 'agent-approval-policy.json')

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && APPROVAL_MODES.includes(value as ApprovalMode)
}

export function isApprovalTimeoutMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_APPROVAL_TIMEOUT_MS
    && value <= MAX_APPROVAL_TIMEOUT_MS
}

export function getApprovalTimeoutAction(mode: ApprovalMode): 'approve' | 'deny' {
  return mode === 'full' ? 'approve' : 'deny'
}

export function getApprovalPolicy(): ApprovalPolicy {
  try {
    const parsed = JSON.parse(fs.readFileSync(policyFile(), 'utf8')) as Partial<ApprovalPolicy>
    if (!isApprovalMode(parsed.mode)) return DEFAULT_POLICY
    return {
      mode: parsed.mode,
      timeoutMs: isApprovalTimeoutMs(parsed.timeoutMs)
        ? parsed.timeoutMs
        : DEFAULT_APPROVAL_TIMEOUT_MS,
    }
  } catch {
    return DEFAULT_POLICY
  }
}

export function saveApprovalPolicy(policy: ApprovalPolicy): ApprovalPolicy {
  if (!isApprovalMode(policy.mode)) throw new Error(`Unsupported approval mode: ${String(policy.mode)}`)
  if (!isApprovalTimeoutMs(policy.timeoutMs)) {
    throw new Error(`Unsupported approval timeout: ${String(policy.timeoutMs)}`)
  }
  durableAtomicWrite(policyFile(), JSON.stringify(policy, null, 2))
  return policy
}

const DANGEROUS_SHELL_PATTERNS = [
  /(?:^|[;&|]\s*)(?:sudo\s+)?rm\s+(?:-[^\s]*\s+)*[^\n;&|]+/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?unlink\s+/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?rmdir\s+/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?del\s+(?:\/[a-z]\s+)*[^\n;&|]+/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:shred|truncate)\s+/i,
  /(?:^|[;&|]\s*)find\s+[^;&|]*\s-delete(?:\s|$)/i,
  /(?:^|[;&|]\s*)git\s+clean(?:\s|$)/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?mkfs(?:\.|\s)/i,
  /(?:^|[;&|]\s*)(?:sudo\s+)?dd\s+[^;&|]*\b(?:if|of)=/i,
  />\s*\/dev\/(?:disk|sd|nvme|rdisk)\w*/i,
  /(?:^|[;&|]\s*)chmod\s+(?:-[^\s]+\s+)*777\b/i,
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
]

export function isDangerousShellCommand(command: string): boolean {
  return DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(command))
}

export function shouldRequestApproval(
  mode: ApprovalMode,
  request: { type: 'read' | 'write' | 'shell'; command?: string },
): boolean {
  if (mode === 'full') return false
  if (mode === 'request') return true
  return request.type === 'shell' && isDangerousShellCommand(request.command ?? '')
}
