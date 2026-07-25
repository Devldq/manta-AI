import { describe, expect, it, vi } from 'vitest'
import { runWithSecurityContext, type SecurityContext } from '../security-context'
import { requestToolApproval } from './request-approval'

function context(
  mode: 'request' | 'auto' | 'full',
  onApprovalRequest: SecurityContext['onApprovalRequest'],
): SecurityContext {
  return {
    taskId: 'approval-policy-test',
    allowedRoots: [process.cwd()],
    shellAllowedRoots: [process.cwd()],
    platform: process.platform,
    approvalMode: mode,
    onApprovalRequest,
  }
}

describe('requestToolApproval policy enforcement', () => {
  it('delegates every boundary request to the user in request mode', async () => {
    const approve = vi.fn(async () => false)
    const result = await runWithSecurityContext(context('request', approve), () =>
      requestToolApproval({ type: 'read', path: '/outside/file.txt' }),
    )
    expect(result).toBe(false)
    expect(approve).toHaveBeenCalledOnce()
  })

  it('auto-approves ordinary file access without opening an approval request', async () => {
    const approve = vi.fn(async () => false)
    const result = await runWithSecurityContext(context('auto', approve), () =>
      requestToolApproval({ type: 'write', path: '/outside/file.txt' }),
    )
    expect(result).toBe(true)
    expect(approve).not.toHaveBeenCalled()
  })

  it('still delegates dangerous bash in auto mode', async () => {
    const approve = vi.fn(async () => false)
    const result = await runWithSecurityContext(context('auto', approve), () =>
      requestToolApproval({ type: 'shell', command: 'rm -rf build' }),
    )
    expect(result).toBe(false)
    expect(approve).toHaveBeenCalledOnce()
  })

  it('adds no application approval boundary in full-access mode', async () => {
    const approve = vi.fn(async () => false)
    const result = await runWithSecurityContext(context('full', approve), () =>
      requestToolApproval({ type: 'shell', command: 'rm -rf build' }),
    )
    expect(result).toBe(true)
    expect(approve).not.toHaveBeenCalled()
  })
})
