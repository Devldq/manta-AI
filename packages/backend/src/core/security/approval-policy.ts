import * as fs from 'node:fs'
import { resolveStoragePath } from '../../storage/path-routing.js'
import { durableAtomicWrite } from '../../storage/durable-atomic.js'

export const APPROVAL_MODES = ['request', 'auto', 'full'] as const
export type ApprovalMode = typeof APPROVAL_MODES[number]

export interface ApprovalPolicy {
  mode: ApprovalMode
}

const DEFAULT_POLICY: ApprovalPolicy = { mode: 'request' }
const policyFile = () => resolveStoragePath('config', 'agent-approval-policy.json')

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && APPROVAL_MODES.includes(value as ApprovalMode)
}

export function getApprovalPolicy(): ApprovalPolicy {
  try {
    const parsed = JSON.parse(fs.readFileSync(policyFile(), 'utf8')) as Partial<ApprovalPolicy>
    return isApprovalMode(parsed.mode) ? { mode: parsed.mode } : DEFAULT_POLICY
  } catch {
    return DEFAULT_POLICY
  }
}

export function saveApprovalPolicy(policy: ApprovalPolicy): ApprovalPolicy {
  if (!isApprovalMode(policy.mode)) throw new Error(`Unsupported approval mode: ${String(policy.mode)}`)
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
