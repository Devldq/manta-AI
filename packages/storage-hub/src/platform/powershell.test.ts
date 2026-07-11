import { describe, expect, it } from 'vitest'
import { PowerShellResolver } from './powershell'

describe('PowerShellResolver', () => {
  it('falls back to pwsh and caches the successful executable', async () => {
    const calls: string[] = []; const resolver = new PowerShellResolver(async (executable) => { calls.push(executable); if (executable === 'powershell.exe') { const error = new Error('missing') as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error } return 'ok' })
    await expect(resolver.run('fixed')).resolves.toBe('ok'); await expect(resolver.run('fixed')).resolves.toBe('ok'); expect(calls).toEqual(['powershell.exe', 'pwsh', 'pwsh'])
  })

  it('reports both missing capabilities clearly', async () => {
    const resolver = new PowerShellResolver(async (executable) => { const error = new Error(`${executable} missing`) as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error })
    await expect(resolver.run('fixed')).rejects.toThrow(/powershell\.exe.*pwsh.*unavailable/i)
  })
})
