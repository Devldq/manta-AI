import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverExtensionTransactions, transactionalInstallDirectory, transactionalUninstallDirectory } from './extension-transactions'

describe('extension storage transactions', () => {
  it('stages replacement and preserves the previous install as a backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-tx-'))
    const source = join(root, 'source'); const destination = join(root, 'extensions', 'plugins', 'demo')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true })
    writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old')
    const result = transactionalInstallDirectory({ extensionsRoot: join(root, 'extensions'), source, destination })
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new')
    expect(readFileSync(join(result.backupPath!, 'plugin.yaml'), 'utf8')).toBe('old')
    expect(existsSync(result.stagingPath)).toBe(false)
  })

  it('moves uninstall content to a retained backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-uninstall-'))
    const destination = join(root, 'extensions', 'plugins', 'demo')
    mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'plugin.yaml'), 'old')
    const backup = transactionalUninstallDirectory({ extensionsRoot: join(root, 'extensions'), destination })
    expect(existsSync(destination)).toBe(false)
    expect(readFileSync(join(backup!, 'plugin.yaml'), 'utf8')).toBe('old')
  })

  it('recovers package and registry together after a crash following backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-recover-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true }); mkdirSync(join(extensionsRoot, 'plugin-registry'), { recursive: true }); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(registry, 'old-registry')
    expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination, registryWrites: new Map([[registry, 'new-registry']]), fault: (phase) => { if (phase === 'after-backup') throw new Error('crash') } })).toThrow('crash')
    expect(existsSync(destination)).toBe(false)
    recoverExtensionTransactions(extensionsRoot)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new'); expect(readFileSync(registry, 'utf8')).toBe('new-registry')
  })

  it('serializes independent instances with a filesystem lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-lock-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'plugin.yaml'), 'new')
    transactionalInstallDirectory({ extensionsRoot, source, destination, fault: (phase) => { if (phase === 'locked') expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination })).toThrow(/lock/i) } })
  })

  it('rejects package symlinks instead of preserving links outside the volume', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-link-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const outside = join(root, 'outside'); mkdirSync(source); mkdirSync(outside); writeFileSync(join(outside, 'secret'), 'outside')
    try { symlinkSync(outside, join(source, 'escape'), 'junction') } catch { return }
    expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination: join(extensionsRoot, 'plugins', 'demo') })).toThrow(/symbolic link/i)
  })

  it('stores only root-relative versioned journal paths and rejects tampered recovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-tamper-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination: join(extensionsRoot, 'plugins', 'demo'), fault: (phase) => { if (phase === 'journaled') throw new Error('crash') } })).toThrow('crash')
    const journalFile = join(extensionsRoot, '.ash-transactions', readdirSync(join(extensionsRoot, '.ash-transactions'))[0])
    const journal = JSON.parse(readFileSync(journalFile, 'utf8'))
    expect(journal.version).toBe(1); expect(JSON.stringify(journal)).not.toContain(extensionsRoot)
    journal.destination = '../outside'; writeFileSync(journalFile, JSON.stringify(journal))
    expect(() => recoverExtensionTransactions(extensionsRoot)).toThrow(/journal|outside|child/i)
    expect(existsSync(join(root, 'outside'))).toBe(false)
  })

  it('rejects recovery through a volume-internal junction to outside', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-journal-link-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const outside = join(root, 'outside'); mkdirSync(source); mkdirSync(outside); writeFileSync(join(source, 'plugin.yaml'), 'new')
    expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination: join(extensionsRoot, 'plugins', 'demo'), fault: (phase) => { if (phase === 'journaled') throw new Error('crash') } })).toThrow('crash')
    try { symlinkSync(outside, join(extensionsRoot, 'plugins'), 'junction') } catch { return }
    expect(() => recoverExtensionTransactions(extensionsRoot)).toThrow(/symbolic|reparse|link/i)
    expect(existsSync(join(outside, 'demo'))).toBe(false)
  })
})
