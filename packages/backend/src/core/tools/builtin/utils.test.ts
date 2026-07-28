import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  runWithSecurityContext,
  type SecurityContext,
} from '../../security-context'
import { checkAccess } from './utils'

function securityContext(
  allowedRoot: string,
  onApprovalRequest: SecurityContext['onApprovalRequest'],
): SecurityContext {
  return {
    taskId: 'builtin-read-approval-test',
    allowedRoots: [allowedRoot],
    shellAllowedRoots: [allowedRoot],
    platform: process.platform,
    approvalMode: 'request',
    approvalTimeoutMs: 15_000,
    onApprovalRequest,
  }
}

describe('built-in read access approval', () => {
  it('reads a real path inside the allowed workspace without approval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-read-inside-'))
    const file = join(root, 'inside.txt')
    writeFileSync(file, 'inside')
    const approve = vi.fn(async () => false)

    const result = await runWithSecurityContext(securityContext(root, approve), () => checkAccess(file))

    expect(result).toEqual({ resolved: realpathSync(file) })
    expect(approve).not.toHaveBeenCalled()
  })

  it('fails closed when an external read is denied', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-read-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'manta-read-outside-'))
    const file = join(outside, 'secret.txt')
    writeFileSync(file, 'secret')
    const approve = vi.fn(async () => false)

    const result = await runWithSecurityContext(securityContext(root, approve), () => checkAccess(file))

    const realFile = realpathSync(file)
    expect(result).toEqual({ error: `用户拒绝了对 "${realFile}" 的读取请求` })
    expect(approve).toHaveBeenCalledWith({ type: 'read', path: realFile })
  })

  it('treats a workspace symlink to an external file as external access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-read-link-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'manta-read-link-outside-'))
    const file = join(outside, 'secret.txt')
    const linkDir = join(root, 'linked')
    writeFileSync(file, 'secret')
    mkdirSync(linkDir)
    const link = join(linkDir, 'secret.txt')
    symlinkSync(file, link)
    const approve = vi.fn(async () => false)

    const result = await runWithSecurityContext(securityContext(root, approve), () => checkAccess(link))

    const realFile = realpathSync(file)
    expect(result).toEqual({ error: `用户拒绝了对 "${realFile}" 的读取请求` })
    expect(approve).toHaveBeenCalledWith({ type: 'read', path: realFile })
  })
})
