import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { ScannedSkill } from '../core/storage/skill/scanner'
import { skillRoutes } from '../routes/skills'
import { runWithStorageResolver } from './path-routing'
import { importSkillPackage } from './skill-package-import'

function scanned(filePath: string, name = 'Demo', version = '1.0.0'): ScannedSkill {
  return { name, description: `${name} skill`, version, type: 'tool', content: '# Demo', filePath, dirName: filePath.split(/[\\/]/).at(-2)! }
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)])
}

describe('immutable skill package import', () => {
  it('installs an external package and snapshots only package files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-package-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); writeFileSync(skillFile, 'shared-bytes')
    const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const installed = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile) }))
    expect(readFileSync(join(extensionsRoot, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('shared-bytes')
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'skill-registry', `${installed.id}.json`), 'utf8')).id).toBe(installed.id)
    const assets = readdirSync(join(volumeRoot, '.ash', 'assets')).map((name) => JSON.parse(readFileSync(join(volumeRoot, '.ash', 'assets', name), 'utf8')))
    expect(assets).toHaveLength(1); expect(assets[0].entries.every((entry: { path: string }) => !entry.path.includes('registry'))).toBe(true)
  })

  it('preserves the existing ID and restores package and registry on snapshot failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-update-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    writeFileSync(skillFile, 'v1'); const first = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile) })); const registryPath = join(extensionsRoot, 'skill-registry', `${first.id}.json`)
    writeFileSync(skillFile, 'v2')
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile, 'Demo', '2.0.0'), existing: first, overwrite: true, snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(join(extensionsRoot, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('v1'); expect(JSON.parse(readFileSync(registryPath, 'utf8')).id).toBe(first.id); expect(JSON.parse(readFileSync(registryPath, 'utf8')).metadata.version).toBe('1.0.0')
  })

  it('leaves a new package and registry absent when snapshot creation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-new-fault-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); writeFileSync(skillFile, 'new'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile), snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(existsSync(join(extensionsRoot, 'skills', 'demo'))).toBe(false)
    expect(readdirSync(join(extensionsRoot, 'skill-registry'))).toEqual([])
  })

  it('deduplicates exact package bytes across identities and versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-dedup-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    for (const [dir, name, version] of [['one', 'One', '1'], ['two', 'Two', '2']]) { const source = join(root, dir); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'equal'); await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, name, version) })) }
    expect(filesUnder(join(volumeRoot, '.ash', 'objects'))).toHaveLength(1); expect(readdirSync(join(volumeRoot, '.ash', 'assets'))).toHaveLength(2)
  })

  it('supports an active managed scan but rejects unrelated destination collisions and links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-safety-')); const volumeRoot = join(root, '.manta-ai'); const extensionsRoot = join(volumeRoot, 'extensions'); const active = join(extensionsRoot, 'skills', 'active'); mkdirSync(active, { recursive: true }); const activeFile = join(active, 'SKILL.md'); writeFileSync(activeFile, 'active'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(activeFile, 'Active') })); expect(readFileSync(activeFile, 'utf8')).toBe('active')
    const external = join(root, 'active'); mkdirSync(external); const externalFile = join(external, 'SKILL.md'); writeFileSync(externalFile, 'intruder')
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(externalFile, 'Intruder') }))).rejects.toThrow(/destination|exists|collision/i); expect(readFileSync(activeFile, 'utf8')).toBe('active')
    const linked = join(root, 'linked'); mkdirSync(linked); const linkedFile = join(linked, 'SKILL.md'); writeFileSync(linkedFile, 'linked'); symlinkSync(active, join(linked, 'alias'), 'junction')
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(linkedFile, 'Linked') }))).rejects.toThrow(/link/i)
  })

  it('keeps only explicit import on the immutable package service and honors its scan dir', () => {
    const routes = readFileSync(new URL('../routes/skills.ts', import.meta.url), 'utf8'); const explicit = routes.slice(routes.indexOf("app.post('/api/skills/import'"), routes.indexOf("app.get('/api/skills/file/:name'"))
    expect(explicit).toContain('scanSkillFiles(dir)'); expect(explicit).toContain('await importSkillPackage('); expect(routes.match(/await importSkillPackage\(/g)).toHaveLength(1)
    expect(routes.slice(0, routes.indexOf("app.post('/api/skills/import'"))).toMatch(/\bcreateSkill\(|\bupdateSkill\(/)
    expect(routes.slice(routes.indexOf("app.get('/api/skills/file/:name'"))).toMatch(/\bcreateAndImportSkill\(|\bwriteSkillSubFile\(/)
  })

  it('honors a custom scan directory through the explicit import route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-route-')); const volumeRoot = join(root, '.manta-ai'); const custom = join(root, 'custom', 'chosen'); mkdirSync(custom, { recursive: true }); writeFileSync(join(custom, 'SKILL.md'), '---\nname: Custom\ndescription: chosen directory\ntype: tool\n---\nCustom body')
    const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments); const app = Fastify(); app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver({ resolve }, done)); await skillRoutes(app)
    const response = await app.inject({ method: 'POST', url: '/api/skills/import', payload: { names: ['Custom'], dir: join(root, 'custom') } })
    expect(response.statusCode).toBe(200); expect(response.json().data.imported).toBe(1); expect(readFileSync(join(volumeRoot, 'extensions', 'skills', 'chosen', 'SKILL.md'), 'utf8')).toContain('name: Custom')
    await app.close()
  })
})
