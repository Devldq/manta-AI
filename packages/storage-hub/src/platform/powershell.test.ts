import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { PowerShellResolver, createPowerShellLauncher } from './powershell'

describe('PowerShellResolver', () => {
  it('falls back to pwsh and caches the successful executable', async () => {
    const calls: string[] = []; const resolver = new PowerShellResolver(async (executable) => { calls.push(executable); if (executable === 'powershell.exe') { const error = new Error('missing') as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error } return 'ok' })
    await expect(resolver.run('fixed')).resolves.toBe('ok'); await expect(resolver.run('fixed')).resolves.toBe('ok'); expect(calls).toEqual(['powershell.exe', 'pwsh', 'pwsh'])
  })

  it('reports both missing capabilities clearly', async () => {
    const resolver = new PowerShellResolver(async (executable) => { const error = new Error(`${executable} missing`) as NodeJS.ErrnoException; error.code = 'ENOENT'; throw error })
    await expect(resolver.run('fixed')).rejects.toThrow(/powershell\.exe.*pwsh.*unavailable/i)
  })

  it('settles once when stdin errors race child error and close', async () => {
    const child = new EventEmitter() as EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough }; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new Writable({ write(_chunk, _encoding, callback) { const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' }); callback(error); queueMicrotask(() => { child.emit('error', error); child.emit('close', 1) }) } })
    const launcher = createPowerShellLauncher(() => child as never); await expect(launcher('powershell.exe', 'fixed', 'x'.repeat(1024 * 1024))).rejects.toThrow(/broken pipe|EPIPE/i)
  })

  it('prefixes every script with BOM-less UTF-8 console encodings', async () => {
    let script = ''; const resolver = new PowerShellResolver(async (_executable, value) => { script = value; return 'ok' }); await resolver.run('Write-Output ok'); expect(script).toMatch(/OutputEncoding.*UTF8Encoding\(\$false\).*InputEncoding/s)
  })
})
