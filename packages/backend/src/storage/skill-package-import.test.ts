import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import type { ScannedSkill } from '../core/storage/skill/scanner'
import { createSkill } from '../core/storage/skill/store'
import { skillRoutes } from '../routes/skills'
import { runWithStorageResolver } from './path-routing'
import { importSkillPackage, validateSkillPackagePath } from './skill-package-import'

function scanned(filePath: string, name = 'Demo', version = '1.0.0'): ScannedSkill {
  return { name, description: `${name} skill`, version, type: 'tool', content: '# Demo', filePath, dirName: filePath.split(/[\\/]/).at(-2)! }
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)])
}

function packageDestination(extensionsRoot: string, skill: { packagePath?: string }): string {
  expect(skill.packagePath).toBeTruthy()
  return resolve(extensionsRoot, skill.packagePath!)
}

describe('immutable skill package import', () => {
  it('uses platform case semantics when reserving Skill package containers', () => {
    expect(() => validateSkillPackagePath('skills/IMPORTED', 'win32')).toThrow(/reserved|container/i)
    expect(() => validateSkillPackagePath('SKILLS/imported', 'win32')).toThrow(/reserved|container/i)
    expect(validateSkillPackagePath('skills/IMPORTED', 'linux')).toBe('skills/IMPORTED')
    expect(() => validateSkillPackagePath('SKILLS/imported', 'linux')).toThrow(/packagePath|inside skills/i)
  })

  it('installs an external package and snapshots only package files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-package-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); writeFileSync(skillFile, 'shared-bytes')
    const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const installed = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile) }))
    expect((installed as { packagePath?: string }).packagePath).toBe(`skills/imported/${installed.id}`)
    expect(readFileSync(join(packageDestination(extensionsRoot, installed as { packagePath?: string }), 'SKILL.md'), 'utf8')).toBe('shared-bytes')
    expect(JSON.parse(readFileSync(join(extensionsRoot, 'skill-registry', `${installed.id}.json`), 'utf8')).id).toBe(installed.id)
    const assets = readdirSync(join(volumeRoot, '.ash', 'assets')).map((name) => JSON.parse(readFileSync(join(volumeRoot, '.ash', 'assets', name), 'utf8')))
    expect(assets).toHaveLength(1); expect(assets[0].entries.every((entry: { path: string }) => !entry.path.includes('registry'))).toBe(true)
  })

  it('preserves the existing ID and restores package and registry on snapshot failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-update-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    writeFileSync(skillFile, 'v1'); const first = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile) })); const registryPath = join(extensionsRoot, 'skill-registry', `${first.id}.json`)
    writeFileSync(skillFile, 'v2')
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile, 'Demo', '2.0.0'), existing: first, overwrite: true, snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(readFileSync(join(packageDestination(extensionsRoot, first as { packagePath?: string }), 'SKILL.md'), 'utf8')).toBe('v1'); expect(JSON.parse(readFileSync(registryPath, 'utf8')).id).toBe(first.id); expect(JSON.parse(readFileSync(registryPath, 'utf8')).metadata.version).toBe('1.0.0')
  })

  it('leaves a new package and registry absent when snapshot creation fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-new-fault-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'demo'); mkdirSync(source); const skillFile = join(source, 'SKILL.md'); writeFileSync(skillFile, 'new'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(skillFile), snapshotPackage: async () => { throw new Error('snapshot fault') } }))).rejects.toThrow(/snapshot fault/)
    expect(existsSync(join(extensionsRoot, 'skills', 'imported')) && readdirSync(join(extensionsRoot, 'skills', 'imported')).length > 0).toBe(false)
    expect(readdirSync(join(extensionsRoot, 'skill-registry'))).toEqual([])
  })

  it('deduplicates exact package bytes across identities and versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-dedup-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    for (const [dir, name, version] of [['one', 'One', '1'], ['two', 'Two', '2']]) { const source = join(root, dir); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'equal'); await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, name, version) })) }
    expect(filesUnder(join(volumeRoot, '.ash', 'objects'))).toHaveLength(1); expect(readdirSync(join(volumeRoot, '.ash', 'assets'))).toHaveLength(2)
  })

  it('supports an active managed scan but rejects unrelated destination collisions and links', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-safety-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const active = join(extensionsRoot, 'skills', 'active'); mkdirSync(active, { recursive: true }); const activeFile = join(active, 'SKILL.md'); writeFileSync(activeFile, 'active'); const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const claimed = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(activeFile, 'Active') })); expect((claimed as { packagePath?: string }).packagePath).toBe('skills/active'); expect(readFileSync(activeFile, 'utf8')).toBe('active')
    await expect(runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(activeFile, 'Other') }))).rejects.toThrow(/claim|owned|packagePath/i)
    const external = join(root, 'active'); mkdirSync(external); const externalFile = join(external, 'SKILL.md'); writeFileSync(externalFile, 'intruder')
    const intruder = await runWithStorageResolver({ resolve }, () => importSkillPackage({ extensionsRoot, scanned: scanned(externalFile, 'Intruder') })); expect(packageDestination(extensionsRoot, intruder as { packagePath?: string })).not.toBe(active); expect(readFileSync(activeFile, 'utf8')).toBe('active')
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
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-route-')); const volumeRoot = join(root, 'manta-ai-data'); const custom = join(root, 'custom', 'chosen'); mkdirSync(custom, { recursive: true }); writeFileSync(join(custom, 'SKILL.md'), '---\nname: Custom\ndescription: chosen directory\ntype: tool\n---\nCustom body')
    const resolve = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments); const app = Fastify(); app.addHook('onRequest', (_request, _reply, done) => runWithStorageResolver({ resolve }, done)); await skillRoutes(app)
    const response = await app.inject({ method: 'POST', url: '/api/skills/import', payload: { names: ['Custom'], dir: join(root, 'custom') } })
    expect(response.statusCode).toBe(200); expect(response.json().data.imported).toBe(1); const registry = readdirSync(join(volumeRoot, 'extensions', 'skill-registry')).map((name) => JSON.parse(readFileSync(join(volumeRoot, 'extensions', 'skill-registry', name), 'utf8')))[0]; expect(readFileSync(join(volumeRoot, 'extensions', registry.packagePath, 'SKILL.md'), 'utf8')).toContain('name: Custom')
    await app.close()
  })

  it('keeps Alpha on its stable path when overwritten from an incoming directory named like Beta', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-owner-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const foo = join(root, 'foo'); const bar = join(root, 'bar'); mkdirSync(foo); mkdirSync(bar); writeFileSync(join(foo, 'SKILL.md'), 'alpha-v1'); writeFileSync(join(bar, 'SKILL.md'), 'beta-v1')
    const alpha = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(foo, 'SKILL.md'), 'Alpha') })); const beta = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(bar, 'SKILL.md'), 'Beta') })); const alphaPath = packageDestination(extensionsRoot, alpha as { packagePath?: string }); const betaPath = packageDestination(extensionsRoot, beta as { packagePath?: string })
    writeFileSync(join(bar, 'SKILL.md'), 'alpha-v2'); const updated = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(bar, 'SKILL.md'), 'Alpha', '2'), existing: alpha, overwrite: true }))
    expect(updated.id).toBe(alpha.id); expect((updated as { packagePath?: string }).packagePath).toBe((alpha as { packagePath?: string }).packagePath); expect(readFileSync(join(alphaPath, 'SKILL.md'), 'utf8')).toBe('alpha-v2'); expect(readFileSync(join(betaPath, 'SKILL.md'), 'utf8')).toBe('beta-v1')
  })

  it('gives nested external packages with the same leaf directory collision-free identities', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-nested-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const one = join(root, 'a', 'same'); const two = join(root, 'b', 'same'); mkdirSync(one, { recursive: true }); mkdirSync(two, { recursive: true }); writeFileSync(join(one, 'SKILL.md'), 'one'); writeFileSync(join(two, 'SKILL.md'), 'two')
    const alpha = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(one, 'SKILL.md'), 'Alpha') })); const beta = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(two, 'SKILL.md'), 'Beta') }))
    expect((alpha as { packagePath?: string }).packagePath).not.toBe((beta as { packagePath?: string }).packagePath); expect(readFileSync(join(packageDestination(extensionsRoot, alpha as { packagePath?: string }), 'SKILL.md'), 'utf8')).toBe('one'); expect(readFileSync(join(packageDestination(extensionsRoot, beta as { packagePath?: string }), 'SKILL.md'), 'utf8')).toBe('two')
  })

  it('rejects forged traversal paths and legacy external overwrites without a managed claim', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-forged-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'v1'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const installed = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha') })); const registryPath = join(extensionsRoot, 'skill-registry', `${installed.id}.json`); const forged = { ...installed, packagePath: '../../outside' }; writeFileSync(registryPath, JSON.stringify(forged)); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha'), existing: forged, overwrite: true }))).rejects.toThrow(/packagePath|outside|traversal|unsafe/i)
    const legacy = { ...installed }; delete (legacy as { packagePath?: string }).packagePath; writeFileSync(registryPath, JSON.stringify(legacy)); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha'), existing: legacy, overwrite: true }))).rejects.toThrow(/legacy|packagePath|managed/i)
  })

  it('rejects a registry packagePath whose managed ancestor is a junction outside extensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-junction-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'v1'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const installed = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha') })); const outside = join(root, 'outside'); mkdirSync(outside); const junction = join(extensionsRoot, 'skills', 'jump'); symlinkSync(outside, junction, 'junction'); const forged = { ...installed, packagePath: 'skills/jump/alpha' }; writeFileSync(join(extensionsRoot, 'skill-registry', `${installed.id}.json`), JSON.stringify(forged))
    await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha'), existing: forged, overwrite: true }))).rejects.toThrow(/link|reparse|outside/i)
  })

  it('rejects an external child claim when its parent package is already owned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-parent-first-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const parent = join(extensionsRoot, 'skills', 'team'); mkdirSync(parent, { recursive: true }); writeFileSync(join(parent, 'SKILL.md'), 'parent'); const external = join(root, 'external'); mkdirSync(external); const externalFile = join(external, 'SKILL.md'); writeFileSync(externalFile, 'child'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(parent, 'SKILL.md'), 'Parent') })); const child = await runWithStorageResolver({ resolve: resolvePath }, () => createSkill({ metadata: { name: 'Child', description: 'child', type: 'tool' }, content: 'child' })); const claimedChild = { ...child, packagePath: 'skills/team/child' }; writeFileSync(join(extensionsRoot, 'skill-registry', `${child.id}.json`), JSON.stringify(claimedChild))
    await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(externalFile, 'Child'), existing: claimedChild, overwrite: true }))).rejects.toThrow(/overlap|ancestor|claim|owned/i)
  })

  it('rejects a parent claim when a child package is already owned', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-child-first-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const parent = join(extensionsRoot, 'skills', 'team'); const child = join(parent, 'child'); mkdirSync(child, { recursive: true }); writeFileSync(join(child, 'SKILL.md'), 'child'); writeFileSync(join(parent, 'SKILL.md'), 'parent'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(child, 'SKILL.md'), 'Child') })); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(parent, 'SKILL.md'), 'Parent') }))).rejects.toThrow(/overlap|ancestor|claim|owned/i)
  })

  it('allows sibling package names that only share a lexical prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-prefix-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    for (const [dir, name] of [['team', 'Team'], ['team-child', 'TeamChild']]) { const active = join(extensionsRoot, 'skills', dir); mkdirSync(active, { recursive: true }); writeFileSync(join(active, 'SKILL.md'), name); await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(active, 'SKILL.md'), name) })) }
    expect(readdirSync(join(extensionsRoot, 'skill-registry'))).toHaveLength(2)
  })

  it('allows the same owner to overwrite its exact package claim', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-same-owner-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'v1'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const first = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha') })); writeFileSync(file, 'v2'); const updated = await runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'Alpha', '2'), existing: first, overwrite: true })); expect(updated.packagePath).toBe(first.packagePath); expect(readFileSync(join(packageDestination(extensionsRoot, updated), 'SKILL.md'), 'utf8')).toBe('v2')
  })

  it('fails safe on malformed persisted claims and reserves package container directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-skill-malformed-')); const volumeRoot = join(root, 'manta-ai-data'); const extensionsRoot = join(volumeRoot, 'extensions'); const source = join(root, 'source'); mkdirSync(source); const file = join(source, 'SKILL.md'); writeFileSync(file, 'new'); const resolvePath = (group: string, ...segments: string[]) => join(volumeRoot, group, ...segments)
    const legacy = await runWithStorageResolver({ resolve: resolvePath }, () => createSkill({ metadata: { name: 'Legacy', description: 'legacy', type: 'tool' }, content: 'legacy' })); writeFileSync(join(extensionsRoot, 'skill-registry', `${legacy.id}.json`), JSON.stringify({ ...legacy, packagePath: 'skills/../escape' })); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(file, 'New') }))).rejects.toThrow(/malformed|invalid|packagePath|unsafe/i)
    writeFileSync(join(extensionsRoot, 'skill-registry', `${legacy.id}.json`), JSON.stringify(legacy)); const skillsRoot = join(extensionsRoot, 'skills'); mkdirSync(skillsRoot, { recursive: true }); writeFileSync(join(skillsRoot, 'SKILL.md'), 'root'); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(skillsRoot, 'SKILL.md'), 'Root') }))).rejects.toThrow(/reserved|container|packagePath/i)
    const importedRoot = join(skillsRoot, 'imported'); mkdirSync(importedRoot, { recursive: true }); writeFileSync(join(importedRoot, 'SKILL.md'), 'container'); await expect(runWithStorageResolver({ resolve: resolvePath }, () => importSkillPackage({ extensionsRoot, scanned: scanned(join(importedRoot, 'SKILL.md'), 'Container') }))).rejects.toThrow(/reserved|container|packagePath/i)
  })
})
