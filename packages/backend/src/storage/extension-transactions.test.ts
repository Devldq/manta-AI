import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverExtensionTransactions, rollbackCompletedExtensionInstall, transactionalInstallDirectory, transactionalUninstallDirectory, withLeasedExtensionInstall } from './extension-transactions'
import { createContentAssetService } from './content-assets'

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

  it('removes an interrupted recursive staging tree and succeeds after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-copy-fault-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); mkdirSync(join(source, 'nested'), { recursive: true }); writeFileSync(join(source, 'a'), 'a'); writeFileSync(join(source, 'nested', 'b'), 'b')
    let copied = 0; expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination, fault: (phase) => { if (phase === 'copy-entry' && ++copied === 2) throw new Error('copy crash') } })).toThrow('copy crash')
    expect(existsSync(destination)).toBe(false); expect(readdirSync(join(extensionsRoot, '.ash-staging'))).toEqual([])
    recoverExtensionTransactions(extensionsRoot); transactionalInstallDirectory({ extensionsRoot, source, destination }); expect(readFileSync(join(destination, 'nested', 'b'), 'utf8')).toBe('b')
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

  it('restores the exact prior package and registries after a completed install', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-rollback-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true }); mkdirSync(join(extensionsRoot, 'plugin-registry'), { recursive: true }); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(registry, 'old-registry')
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination, registryWrites: new Map([[registry, 'new-registry']]) }, async () => { throw new Error('decision failed') })).rejects.toThrow(/decision failed/)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old'); expect(readFileSync(registry, 'utf8')).toBe('old-registry')
  })

  it('removes a first install and newly-created registry during completed rollback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-first-rollback-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination, registryWrites: new Map([[registry, 'new-registry']]) }, async () => { throw new Error('decision failed') })).rejects.toThrow(/decision failed/)
    expect(existsSync(destination)).toBe(false); expect(existsSync(registry)).toBe(false)
  })

  it('refuses completed rollback through a linked backup ancestor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-rollback-link-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const outside = join(root, 'outside')
    mkdirSync(source); mkdirSync(outside); writeFileSync(join(source, 'plugin.yaml'), 'new')
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination }, async () => {
      const backupRoot = join(extensionsRoot, '.ash-backups'); const retained = `${backupRoot}-retained`; mkdirSync(backupRoot); renameSync(backupRoot, retained); symlinkSync(outside, backupRoot, process.platform === 'win32' ? 'junction' : 'dir'); throw new Error('decision failed')
    })).rejects.toThrow(/symbolic|reparse|link/i)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new'); expect(readdirSync(outside)).toEqual([])
  })

  it('rejects a forged completed-install rollback receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-forged-')); const extensionsRoot = join(root, 'extensions'); const destination = join(extensionsRoot, 'plugins', 'demo'); mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'plugin.yaml'), 'keep')
    expect(() => rollbackCompletedExtensionInstall({ extensionsRoot, destination, transactionId: '00000000-0000-4000-8000-000000000000', registryPaths: [], stagingPath: '' } as never)).toThrow(/receipt|issued|authorized/i)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('keep')
  })

  it('makes issued lease receipts immutable and rejects their reuse after the decision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-receipt-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const outside = join(root, 'outside'); mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    let issued: Parameters<typeof rollbackCompletedExtensionInstall>[0] | undefined
    await withLeasedExtensionInstall({ extensionsRoot, source, destination }, async (receipt) => {
      issued = receipt
      expect(() => Object.assign(receipt, { destination: outside })).toThrow()
      return undefined
    })
    expect(() => rollbackCompletedExtensionInstall(issued!)).toThrow(/receipt|lease|issued/i)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new'); expect(existsSync(outside)).toBe(false)
  })

  it('keeps automatic rollback idempotent if a leased decision already rolled back', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-idempotent-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); mkdirSync(source); mkdirSync(destination, { recursive: true }); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old')
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination }, async (receipt) => { rollbackCompletedExtensionInstall(receipt); throw new Error('decision failed') })).rejects.toThrow(/decision failed/)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old')
  })

  it('rejects registry writes through a junction before installing or backing up anything', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-registry-link-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const outside = join(root, 'outside'); mkdirSync(source); mkdirSync(extensionsRoot); mkdirSync(outside); writeFileSync(join(source, 'plugin.yaml'), 'new')
    try { symlinkSync(outside, join(extensionsRoot, 'plugin-registry'), process.platform === 'win32' ? 'junction' : 'dir') } catch { return }
    expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination, registryWrites: new Map([[join(extensionsRoot, 'plugin-registry', 'demo.json'), 'new-registry']]) })).toThrow(/symbolic|reparse|outside|link/i)
    expect(existsSync(destination)).toBe(false); expect(readdirSync(outside)).toEqual([])
  })

  it('recovers an install interrupted after commit but before its snapshot completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-awaiting-crash-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true }); mkdirSync(join(extensionsRoot, 'plugin-registry')); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(registry, 'old-registry')
    let snapshotStarted = false
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination, registryWrites: new Map([[registry, 'new-registry']]), fault: (phase) => { if (phase === 'awaiting-snapshot') throw new Error('process died') } }, async () => { snapshotStarted = true })).rejects.toThrow(/process died/)
    expect(snapshotStarted).toBe(false); expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('new'); expect(readFileSync(registry, 'utf8')).toBe('new-registry')
    recoverExtensionTransactions(extensionsRoot)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old'); expect(readFileSync(registry, 'utf8')).toBe('old-registry'); expect(readdirSync(join(extensionsRoot, '.ash-transactions'))).toEqual([])
  })

  it('rolls back on restart after a snapshot publishes but before its keep decision is acknowledged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-published-crash-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); const destination = join(extensionsRoot, 'plugins', 'demo'); const registry = join(extensionsRoot, 'plugin-registry', 'demo.json')
    mkdirSync(source, { recursive: true }); mkdirSync(destination, { recursive: true }); mkdirSync(join(extensionsRoot, 'plugin-registry')); writeFileSync(join(source, 'plugin.yaml'), 'new'); writeFileSync(join(destination, 'plugin.yaml'), 'old'); writeFileSync(registry, 'old-registry')
    let manifestId = ''
    await expect(withLeasedExtensionInstall({ extensionsRoot, source, destination, registryWrites: new Map([[registry, 'new-registry']]), fault: (phase) => { if (phase === 'after-snapshot-publish') throw new Error('process died') } }, async () => {
      manifestId = (await createContentAssetService({ volumeRoot }).snapshotPackage({ kind: 'plugin', logicalId: 'plugin-demo', version: '2', sourceRoot: destination })).manifest.assetId
    })).rejects.toThrow(/process died/)
    expect(existsSync(join(volumeRoot, '.ash', 'assets', `${manifestId}.json`))).toBe(true)
    recoverExtensionTransactions(extensionsRoot)
    expect(readFileSync(join(destination, 'plugin.yaml'), 'utf8')).toBe('old'); expect(readFileSync(registry, 'utf8')).toBe('old-registry'); expect(existsSync(join(volumeRoot, '.ash', 'assets', `${manifestId}.json`))).toBe(true); expect(readdirSync(join(extensionsRoot, '.ash-transactions'))).toEqual([])
  })

  it('rejects overlapping package and registry paths before creating partial state', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-extension-overlap-')); const extensionsRoot = join(root, 'extensions'); const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(source, 'plugin.yaml'), 'new')
    const cases = [
      { destination: join(extensionsRoot, 'plugins', 'nested'), registries: [join(extensionsRoot, 'plugins', 'nested', 'registry.json')] },
      { destination: join(extensionsRoot, 'plugins', 'equal'), registries: [join(extensionsRoot, 'plugins', 'equal')] },
      { destination: join(extensionsRoot, 'plugins', 'parent'), registries: [join(extensionsRoot, 'plugins')] },
      { destination: join(extensionsRoot, 'plugins', 'pair'), registries: [join(extensionsRoot, 'plugin-registry'), join(extensionsRoot, 'plugin-registry', 'demo.json')] },
    ]
    for (const item of cases) {
      expect(() => transactionalInstallDirectory({ extensionsRoot, source, destination: item.destination, registryWrites: new Map(item.registries.map((path) => [path, 'registry'])) })).toThrow(/overlap|nested|registry/i)
      expect(existsSync(item.destination)).toBe(false)
    }
    expect(existsSync(join(extensionsRoot, '.ash-transactions'))).toBe(false)
  })
})
