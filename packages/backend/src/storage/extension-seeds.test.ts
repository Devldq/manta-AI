import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedBundledExtensions } from './extension-seeds'

describe('bundled extension seeds', () => {
  it('seeds an empty volume, is idempotent, upgrades unchanged assets, and preserves user edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-seeds-')); const seedRoot = join(root, 'bundle'); const extensionsRoot = join(root, 'extensions'); const source = join(seedRoot, 'skills', 'demo', 'SKILL.md'); mkdirSync(join(seedRoot, 'skills', 'demo'), { recursive: true }); writeFileSync(source, 'v1')
    seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' }); const installed = join(extensionsRoot, 'skills', 'demo', 'SKILL.md'); expect(readFileSync(installed, 'utf8')).toBe('v1')
    writeFileSync(source, 'changed-without-version'); seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' }); expect(readFileSync(installed, 'utf8')).toBe('v1')
    seedBundledExtensions({ extensionsRoot, seedRoot, version: '2' }); expect(readFileSync(installed, 'utf8')).toBe('changed-without-version')
    writeFileSync(installed, 'user-edit'); writeFileSync(source, 'v3'); seedBundledExtensions({ extensionsRoot, seedRoot, version: '3' }); expect(readFileSync(installed, 'utf8')).toBe('user-edit')
  })

  it('imports historical .manta registry JSON into registries instead of package trees', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-real-seeds-')); const seedRoot = join(root, 'repo'); const extensionsRoot = join(root, 'extensions')
    mkdirSync(join(seedRoot, '.manta', 'skills'), { recursive: true }); mkdirSync(join(seedRoot, '.manta', 'plugins'), { recursive: true })
    writeFileSync(join(seedRoot, '.manta', 'skills', 'skill-demo.json'), JSON.stringify({ id: 'skill-demo', metadata: { name: 'Demo' } }))
    writeFileSync(join(seedRoot, '.manta', 'plugins', 'plugin-demo.json'), JSON.stringify({ id: 'plugin-demo', manifest: { name: 'Demo', version: '1' } }))
    seedBundledExtensions({ extensionsRoot, seedRoot, version: '1' })
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'skill-registry', 'skill-demo.json'), 'utf8')).id).toBe('skill-demo')
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'plugin-registry', 'plugin-demo.json'), 'utf8')).id).toBe('plugin-demo')
  })
})
