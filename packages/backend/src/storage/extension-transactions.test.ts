import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transactionalInstallDirectory, transactionalUninstallDirectory } from './extension-transactions'

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
})
