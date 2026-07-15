import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from './adapter-registry'
import { ProjectionCoordinator, SimulatedAdapterCrash } from './projection-coordinator'
import type { ProjectionCoordinatorOptions } from './projection-coordinator'
import type {
  AdapterJournal,
  AdapterResult,
  AgentAdapter,
  AgentInstallation,
  ApprovedAdapterPlan,
  AssetSelection,
  PreviewFileOperation,
  ProjectionPlan,
} from './types'

const directories: string[] = []
async function directory(prefix = 'ash-adapter-'): Promise<string> { const path = await mkdtemp(join(tmpdir(), prefix)); directories.push(path); return path }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const selection: AssetSelection = { schemaVersion: 1, assetIds: ['asset'] }

function installation(root: string, id = 'target', adapterId = 'fixture'): AgentInstallation {
  return { schemaVersion: 1, id, adapterId, displayName: id, nativeRoots: [{ id: 'home', path: root }] }
}

function rawPlan(target: AgentInstallation, operations: PreviewFileOperation[], overrides: Partial<ProjectionPlan> = {}): ProjectionPlan {
  return {
    schemaVersion: 1,
    kind: 'projection',
    planId: 'plan-1',
    adapterId: target.adapterId,
    target,
    selection,
    operations,
    createdAt: '2026-07-14T00:00:00.000Z',
    expiresAt: '2026-07-14T01:00:00.000Z',
    digest: '',
    ...overrides,
  }
}

function result(plan: ApprovedAdapterPlan, status: AdapterResult['status'] = 'applied'): AdapterResult {
  return {
    schemaVersion: 1,
    operationId: plan.approval.operationId,
    planId: plan.planId,
    adapterId: plan.adapterId,
    installationId: plan.target.id,
    status,
    verified: true,
    completedAt: '2026-07-14T00:00:01.000Z',
  }
}

function fixtureAdapter(target: AgentInstallation, operations: PreviewFileOperation[], apply: AgentAdapter['apply'] = async (plan) => result(plan)): AgentAdapter {
  return {
    id: target.adapterId,
    displayName: 'Fixture',
    detect: async () => [target],
    inspect: async () => ({ schemaVersion: 1, installationId: target.id, assets: [] }),
    planImport: async (importSelection) => ({ ...rawPlan(target, operations), kind: 'import', selection: importSelection }),
    planProjection: async () => rawPlan(target, operations),
    apply,
  }
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }
async function journalAt(stateRoot: string, operationId: string): Promise<AdapterJournal> {
  return JSON.parse(await readFile(join(stateRoot, '.ash', 'adapters', 'journals', `${operationId}.json`), 'utf8')) as AdapterJournal
}
function makeCoordinator(options: Omit<ProjectionCoordinatorOptions, 'coordinationRoot'> & { coordinationRoot?: string }): ProjectionCoordinator {
  return new ProjectionCoordinator({ ...options, coordinationRoot: options.coordinationRoot ?? join(options.stateRoot, '.coordination') })
}

describe('ProjectionCoordinator preview and approval', () => {
  it('keeps detect, inspect, import preview, and projection preview read-only', async () => {
    const file = join(await directory('ash-native-'), 'asset.txt'); await writeFile(file, 'old'); const target = installation(dirname(file)); const operations: PreviewFileOperation[] = [{ id: 'read', kind: 'read', rootId: 'home', nativePath: file }]
    const stateRoot = join(await directory('ash-state-parent-'), 'missing-state'); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, operations)]), now: () => new Date('2026-07-14T00:10:00.000Z') })
    await coordinator.detect('fixture'); await coordinator.inspect('fixture', target); await coordinator.planImport('fixture', target); const plan = await coordinator.planProjection('fixture', selection, target)
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.operations)).toBe(true)
    expect(await exists(stateRoot)).toBe(false); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('rejects unapproved, mutated, expired, foreign-adapter, and target-mismatched plans before writing', async () => {
    const nativeRoot = await directory('ash-native-'); const stateRoot = join(await directory('ash-state-parent-'), 'state'); const target = installation(nativeRoot)
    const validOperations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: join(nativeRoot, 'file'), expectedAfterSha256: sha256('new') }]
    const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, validOperations)]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const plan = await coordinator.planProjection('fixture', selection, target)
    await expect(coordinator.apply(plan as ApprovedAdapterPlan)).rejects.toThrow(/approval/i)
    const approved = coordinator.approve(plan)
    const mutated = structuredClone(approved); (mutated.operations as PreviewFileOperation[])[0] = { ...mutated.operations[0], nativePath: join(nativeRoot, 'other') }
    await expect(coordinator.apply(mutated)).rejects.toThrow(/digest|mutated/i)
    const expired = structuredClone(approved); (expired as { expiresAt: string }).expiresAt = '2026-07-14T00:00:00.000Z'
    await expect(coordinator.apply(expired)).rejects.toThrow(/expired|digest/i)
    const foreign = structuredClone(approved); (foreign.approval as { adapterId: string }).adapterId = 'foreign'
    await expect(coordinator.apply(foreign)).rejects.toThrow(/foreign|adapter/i)
    const mismatch = structuredClone(approved); (mismatch.approval as { installationId: string }).installationId = 'other'
    await expect(coordinator.apply(mismatch)).rejects.toThrow(/target|installation/i)
    expect(await exists(stateRoot)).toBe(false)
  })

  it('rejects a stale plan when native bytes change after preview and before any journal write', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'planned')
    const target = installation(nativeRoot); const operation = { id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedBeforeSha256: sha256('planned'), expectedAfterSha256: sha256('new') } as PreviewFileOperation
    const stateRoot = join(await directory(), 'state'); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, [operation])]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target)); await writeFile(file, 'changed')
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|changed/i); expect(await exists(stateRoot)).toBe(false); expect(await readFile(file, 'utf8')).toBe('changed')
  })
})

describe('ProjectionCoordinator path authorization', () => {
  it('allows configured control roots beneath a trusted linked platform prefix', async () => {
    const parent = await directory('ash-linked-prefix-'); const physical = join(parent, 'physical'); const alias = join(parent, 'alias'); await mkdir(physical); await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const target = installation(nativeRoot)
    const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) })])
    const coordinator = makeCoordinator({ stateRoot: join(alias, 'state'), coordinationRoot: join(alias, 'coordination'), registry, now: () => new Date('2026-07-14T00:10:00.000Z') })

    await expect(coordinator.apply(coordinator.approve(await coordinator.planProjection('fixture', selection, target)))).resolves.toMatchObject({ status: 'committed' })
    await expect(readFile(file, 'utf8')).resolves.toBe('new')
  })

  it.each([
    ['relative', (_root: string) => 'relative/file'],
    ['escape', (root: string) => join(root, '..', 'escape.txt')],
    ['NUL', (root: string) => `${join(root, 'file')}\0suffix`],
  ])('rejects %s paths', async (_label, pathFor) => {
    const nativeRoot = await directory('ash-native-'); const target = installation(nativeRoot); const op: PreviewFileOperation = { id: 'bad', kind: 'create', rootId: 'home', nativePath: pathFor(nativeRoot), expectedAfterSha256: sha256('x') }
    const stateRoot = join(await directory(), 'state'); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, [op])]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/path|absolute|root|NUL/i); expect(await exists(stateRoot)).toBe(false)
  })

  it('rejects duplicate/conflicting paths even when disguised under different roots', async () => {
    const nativeRoot = await directory('ash-native-'); const target = { ...installation(nativeRoot), nativeRoots: [{ id: 'one', path: nativeRoot }, { id: 'two', path: nativeRoot }] }; const file = join(nativeRoot, 'same')
    const ops: PreviewFileOperation[] = [{ id: 'one', kind: 'read', rootId: 'one', nativePath: file }, { id: 'two', kind: 'delete', rootId: 'two', nativePath: file }]
    const coordinator = makeCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, ops)]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/duplicate|conflict|root/i)
  })

  it('rejects symlink or junction ancestors without following them', async () => {
    const nativeRoot = await directory('ash-native-'); const elsewhere = await directory('ash-elsewhere-'); const linked = join(nativeRoot, 'linked')
    await symlink(elsewhere, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const target = installation(nativeRoot); const op: PreviewFileOperation = { id: 'linked', kind: 'create', rootId: 'home', nativePath: join(linked, 'file'), expectedAfterSha256: sha256('x') }
    const coordinator = makeCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, [op])]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/link|junction|symbolic/i)
  })

  it.each(['journal', 'backup'] as const)('does not follow a linked %s control directory', async (kind) => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const target = installation(nativeRoot); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const stateRoot = join(await directory(), 'state'); const outside = await directory('ash-outside-'); await mkdir(stateRoot, { recursive: true })
    if (kind === 'journal') await symlink(outside, join(stateRoot, '.ash'), process.platform === 'win32' ? 'junction' : 'dir'); else await symlink(outside, join(stateRoot, '.ash-backups'), process.platform === 'win32' ? 'junction' : 'dir')
    const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) }); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/link|junction|control|rollback.*safe/i); expect(await readdir(outside)).toEqual([]); expect(await readFile(file, 'utf8')).toBe('old')
  })
})

describe('ProjectionCoordinator transaction and rollback', () => {
  it('creates approved directory claims before nested file claims and removes only empty owned directories on rollback', async () => {
    const nativeRoot = await directory('ash-native-'); const skillDirectory = join(nativeRoot, 'skills', 'portable'); const skillFile = join(skillDirectory, 'SKILL.md')
    const operations = [
      { id: 'skills-dir', kind: 'create-directory', rootId: 'home', nativePath: join(nativeRoot, 'skills') },
      { id: 'skill-dir', kind: 'create-directory', rootId: 'home', nativePath: skillDirectory },
      { id: 'skill-file', kind: 'create', rootId: 'home', nativePath: skillFile, expectedAfterSha256: sha256('portable') },
    ] as unknown as PreviewFileOperation[]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state')
    const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(skillFile, 'portable'); return result(plan) })])
    const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') })
    const committed = await coordinator.apply(coordinator.approve(await coordinator.planProjection('fixture', selection, target)))
    expect(await readFile(skillFile, 'utf8')).toBe('portable')
    await coordinator.rollback(committed.operationId)
    expect(await exists(join(nativeRoot, 'skills'))).toBe(false)
  }, 10_000)

  it('rejects directory claims that are ordered after a descendant write', async () => {
    const nativeRoot = await directory('ash-native-'); const child = join(nativeRoot, 'skill', 'SKILL.md')
    const operations = [{ id: 'child', kind: 'create', rootId: 'home', nativePath: child, expectedAfterSha256: sha256('child') }, { id: 'parent', kind: 'create-directory', rootId: 'home', nativePath: dirname(child) }] as PreviewFileOperation[]
    const target = installation(nativeRoot); const coordinator = makeCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, operations)]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/directory.*before|topological|order/i)
  })

  it('rejects and cannot silently commit when an adapter replaces an owned directory claim', async () => {
    const nativeRoot = await directory('ash-native-'); const claimed = join(nativeRoot, 'skill'); const operations = [{ id: 'directory', kind: 'create-directory', rootId: 'home', nativePath: claimed }] as PreviewFileOperation[]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await rm(claimed, { recursive: true }); await mkdir(claimed); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') })
    const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target)); await expect(coordinator.apply(approved)).rejects.toThrow(/directory.*claim|identity|safe/i); expect(await exists(claimed)).toBe(true)
  })

  it.each(['after-directory-intent', 'after-directory-marker', 'after-directory-identity'] as const)('recovers a directory claim crash at %s without leaving ownership artifacts', async (point) => {
    const nativeRoot = await directory('ash-native-'); const targetDirectory = join(nativeRoot, 'skills')
    const operations = [{ id: 'skills-dir', kind: 'create-directory', rootId: 'home', nativePath: targetDirectory }] as PreviewFileOperation[]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)])
    const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (candidate) => { if (candidate === point) throw new SimulatedAdapterCrash(point) } })
    const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    await makeCoordinator({ stateRoot, registry }).recoverPending(); await makeCoordinator({ stateRoot, registry }).recoverPending()
    expect(await exists(targetDirectory)).toBe(false)
    expect(await readdir(nativeRoot)).toEqual([])
  })

  it('fails closed and preserves an empty directory after a crash between exclusive mkdir and ownership marker', async () => {
    const nativeRoot = await directory('ash-native-'); const targetDirectory = join(nativeRoot, 'skills')
    const operations = [{ id: 'skills-dir', kind: 'create-directory', rootId: 'home', nativePath: targetDirectory }] as PreviewFileOperation[]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)])
    const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-directory-mkdir') throw new SimulatedAdapterCrash(point) } })
    const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target)); await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/directory.*ownership|marker|safe/i)
    expect(await readdir(targetDirectory)).toEqual([])
  })

  it('revalidates digest and file identity from the same no-follow backup handle before calling the adapter', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; let applyCalls = 0
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { applyCalls += 1; await writeFile(file, 'new'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-journal') { await rm(file); await writeFile(file, 'old') } } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|identity|changed/i); expect(applyCalls).toBe(0); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('revalidates all before-state after every backup and aborts without overwriting a concurrent user change', async () => {
    const nativeRoot = await directory('ash-native-'); const first = join(nativeRoot, 'first'); const second = join(nativeRoot, 'second'); await writeFile(first, 'old-one'); await writeFile(second, 'old-two'); const operations: PreviewFileOperation[] = [{ id: 'first', kind: 'modify', rootId: 'home', nativePath: first, expectedAfterSha256: sha256('new-one') }, { id: 'second', kind: 'modify', rootId: 'home', nativePath: second, expectedAfterSha256: sha256('new-two') }]; let backupEntries = 0; let applyCalls = 0
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { applyCalls += 1; await writeFile(first, 'new-one'); await writeFile(second, 'new-two'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-backup-entry' && ++backupEntries === 1) await writeFile(first, 'user-change') } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|changed/i); expect(applyCalls).toBe(0); expect(await readFile(first, 'utf8')).toBe('user-change'); expect(await readFile(second, 'utf8')).toBe('old-two'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('revalidates the complete before-state after the before-apply hook returns', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; let applyCalls = 0
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { applyCalls += 1; await writeFile(file, 'new'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') await writeFile(file, 'user-change') } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|changed/i); expect(applyCalls).toBe(0); expect(await readFile(file, 'utf8')).toBe('user-change'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('requires a safe existing parent before planning a create claim', async () => {
    const nativeRoot = await directory('ash-native-'); const target = installation(nativeRoot); const created = join(nativeRoot, 'missing-parent', 'file'); const operation: PreviewFileOperation = { id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }; const coordinator = makeCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, [operation])]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/parent.*exist|ordinary.*parent/i)
  })

  it('backs up modify/delete files, marks creates absent, commits, and explicitly rolls back byte-for-byte', async () => {
    const nativeRoot = await directory('ash-native-'); const modify = join(nativeRoot, 'modify.txt'); const remove = join(nativeRoot, 'delete.txt'); const create = join(nativeRoot, 'create.txt')
    await writeFile(modify, Buffer.from([0, 1, 2, 255])); await writeFile(remove, 'remove-old')
    const operations: PreviewFileOperation[] = [
      { id: 'modify', kind: 'modify', rootId: 'home', nativePath: modify, expectedAfterSha256: sha256('modified') },
      { id: 'delete', kind: 'delete', rootId: 'home', nativePath: remove },
      { id: 'create', kind: 'create', rootId: 'home', nativePath: create, expectedAfterSha256: sha256('created') },
    ]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(modify, 'modified'); await rm(remove); await writeFile(create, 'created'); return result(plan) })
    const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const plan = await coordinator.planProjection('fixture', selection, target); const committed = await coordinator.apply(coordinator.approve(plan))
    expect(committed.status).toBe('committed'); const journal = await journalAt(stateRoot, committed.operationId); expect(journal.phase).toBe('committed'); expect(journal.backupEntries.map((entry) => entry.priorState).sort()).toEqual(['absent', 'file', 'file'])
    expect(await readdir(join(stateRoot, '.ash-backups', 'adapters', committed.operationId))).toHaveLength(2)
    await coordinator.rollback(committed.operationId)
    expect(await readFile(modify)).toEqual(Buffer.from([0, 1, 2, 255])); expect(await readFile(remove, 'utf8')).toBe('remove-old'); expect(await exists(create)).toBe(false); expect((await journalAt(stateRoot, committed.operationId)).phase).toBe('rolled-back')
    await coordinator.rollback(committed.operationId)
  })

  it('automatically rolls back an adapter throw for backed-up files and a verification failure with recorded create ownership', async () => {
    for (const mode of ['throw', 'verify'] as const) {
      const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const created = join(nativeRoot, 'created'); await writeFile(existing, 'old')
      const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, ...(mode === 'verify' ? [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') } as PreviewFileOperation] : [])]
      const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(existing, mode === 'verify' ? 'wrong' : 'new'); if (mode === 'verify') await writeFile(created, 'created'); if (mode === 'throw') throw new Error('adapter failed'); return result(plan) })
      const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
      await expect(coordinator.apply(approved)).rejects.toThrow(mode === 'throw' ? /adapter failed/ : /verification/i)
      expect(await readFile(existing, 'utf8')).toBe('old'); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
    }
  })

  it('removes the coordinator-owned create claim after an adapter throw', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async () => { await writeFile(created, 'created'); throw new Error('adapter failed') }); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/adapter failed/i); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('does not adopt a user create attempt while the adapter owns an exclusive claim', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('expected') }]; let userCreated = true
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { try { await writeFile(created, 'user', { flag: 'wx' }) } catch { userCreated = false }; return result(plan) }); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/verification/i); expect(userCreated).toBe(false); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('revalidates non-create before-state after the final create claim hook returns', async () => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const first = join(nativeRoot, 'first'); const second = join(nativeRoot, 'second'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, { id: 'first', kind: 'create', rootId: 'home', nativePath: first, expectedAfterSha256: sha256('first') }, { id: 'second', kind: 'create', rootId: 'home', nativePath: second, expectedAfterSha256: sha256('second') }]; let claims = 0; let applyCalls = 0
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { applyCalls += 1; await writeFile(existing, 'new'); await writeFile(first, 'first'); await writeFile(second, 'second'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-claim' && ++claims === 2) await writeFile(existing, 'user-change') } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|changed/i); expect(applyCalls).toBe(0); expect(await readFile(existing, 'utf8')).toBe('user-change'); expect(await exists(first)).toBe(false); expect(await exists(second)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('does not delete a committed create replaced by another file with identical bytes', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(created, 'created'); return result(plan) }); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const committed = await coordinator.apply(coordinator.approve(await coordinator.planProjection('fixture', selection, target))); await rm(created); await writeFile(created, 'created')
    await expect(coordinator.rollback(committed.operationId)).rejects.toThrow(/ownership|safe/i); expect(await readFile(created, 'utf8')).toBe('created'); expect((await journalAt(stateRoot, committed.operationId)).phase).toBe('rolling-back')
  })

  it('fails closed when an adapter replaces rather than writes the coordinator claim in place', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await rm(created); await writeFile(created, 'created'); return result(plan) }); const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/claim|identity|safe/i); expect(await readFile(created, 'utf8')).toBe('created'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolling-back')
  })
})

describe('ProjectionCoordinator crash recovery', () => {
  it('rebuilds sanitized operation summaries from validated durable journals after restart', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(created, 'created'); return { ...result(plan), materializationStrategies: [{ operationId: 'create', strategy: 'copy' }] } })]); const first = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') })
    const committed = await first.apply(first.approve(await first.planProjection('fixture', selection, target))); const restarted = makeCoordinator({ stateRoot, registry })
    await expect(restarted.getOperationSummary('unknown-operation')).resolves.toBeUndefined()
    const summary = await restarted.getOperationSummary(committed.operationId)
    expect(summary).toEqual(expect.objectContaining({ operationId: committed.operationId, adapterId: 'fixture', installationId: 'target', kind: 'projection', phase: 'committed', verified: true, operationCount: 1, materializationStrategies: { clone: 0, copy: 1 } }))
    expect(JSON.stringify(summary)).not.toContain(nativeRoot); expect(JSON.stringify(summary)).not.toContain('backupRelativePath'); expect(await restarted.listOperationSummaries()).toEqual([summary])
    await restarted.rollback(committed.operationId); expect(await restarted.getOperationSummary(committed.operationId)).toEqual(expect.objectContaining({ phase: 'rolled-back', verified: true }))
  })

  it('recovers a durably published claim whose identity journal write never happened', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-claim-publish') throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); const pending = await journalAt(stateRoot, approved.approval.operationId); expect(pending.backupEntries[0].claimFileIdentity).toBeUndefined(); expect(await exists(created)).toBe(true)
    await makeCoordinator({ stateRoot, registry }).recoverPending(); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('preserves a foreign replacement at a published claim with no journaled identity', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-claim-publish') throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target)); await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await rm(created); await writeFile(created, 'foreign')
    await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/claim|ownership|evidence|safe/i); expect(await readFile(created, 'utf8')).toBe('foreign'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('aborting-claims')
  })

  it('resumes claim-only abort without restoring existing backups after a quarantine crash', async () => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const first = join(nativeRoot, 'first'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, { id: 'first', kind: 'create', rootId: 'home', nativePath: first, expectedAfterSha256: sha256('first') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(existing, 'new'); await writeFile(first, 'first'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-claim') throw new Error('stop before adapter'); if (point === 'after-create-quarantine-rename') throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/failed|crash/i); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('aborting-claims'); await writeFile(existing, 'user-change'); await makeCoordinator({ stateRoot, registry }).recoverPending()
    expect(await readFile(existing, 'utf8')).toBe('user-change'); expect(await exists(first)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('idempotently completes create rollback after a crash between quarantine rename and deletion', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(created, 'created'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-quarantine-rename') throw new SimulatedAdapterCrash(point) } }); const committed = await coordinator.apply(coordinator.approve(await coordinator.planProjection('fixture', selection, target))); const quarantine = join(nativeRoot, `.ash-rollback-${sha256(`{"operationEntryId":"create","operationId":"${committed.operationId}"}`)}`)
    await expect(coordinator.rollback(committed.operationId)).rejects.toBeInstanceOf(SimulatedAdapterCrash); expect(await exists(created)).toBe(false); expect(await readFile(quarantine, 'utf8')).toBe('created')
    const recovery = makeCoordinator({ stateRoot, registry }); await recovery.recoverPending(); await recovery.recoverPending(); expect(await exists(quarantine)).toBe(false); expect((await journalAt(stateRoot, committed.operationId)).phase).toBe('rolled-back')
  })

  it('preserves and fails closed on a quarantine identity mismatch during crash recovery', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(created, 'created'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-create-quarantine-rename') throw new SimulatedAdapterCrash(point) } }); const committed = await coordinator.apply(coordinator.approve(await coordinator.planProjection('fixture', selection, target))); const quarantine = join(nativeRoot, `.ash-rollback-${sha256(`{"operationEntryId":"create","operationId":"${committed.operationId}"}`)}`); await expect(coordinator.rollback(committed.operationId)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await rm(quarantine); await writeFile(quarantine, 'unrelated')
    await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/quarantine.*identity|safe/i); expect(await readFile(quarantine, 'utf8')).toBe('unrelated'); expect((await journalAt(stateRoot, committed.operationId)).phase).toBe('rolling-back')
  })

  it.each(['after-journal', 'after-backup-entry', 'before-apply'] as const)('recovers idempotently from %s', async (point) => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(existing, 'new'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (candidate) => { if (candidate === point) throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const recovery = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:11:00.000Z') }); await recovery.recoverPending(); await recovery.recoverPending()
    expect(await readFile(existing, 'utf8')).toBe('old'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('pre-apply recovery never restores an existing backup over a later user change', async () => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await writeFile(existing, 'user-change')
    const recovery = makeCoordinator({ stateRoot, registry }); await recovery.recoverPending(); await recovery.recoverPending(); expect(await readFile(existing, 'utf8')).toBe('user-change'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('rolls back a crash thrown during adapter apply', async () => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const created = join(nativeRoot, 'created'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, { id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async () => { await writeFile(existing, 'new'); await writeFile(created, 'created'); throw new SimulatedAdapterCrash('during-apply') })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await makeCoordinator({ stateRoot, registry }).recoverPending()
    expect(await readFile(existing, 'utf8')).toBe('old'); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('finishes commit after adapter apply completed and recovery is repeated', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) })]); const coordinator = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-applied-journal') throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); const recovery = makeCoordinator({ stateRoot, registry }); await recovery.recoverPending(); await recovery.recoverPending()
    expect(await readFile(file, 'utf8')).toBe('new'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('committed')
  })

  it('automatically rolls back when applied recovery verification fails', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) })]); const crashing = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-applied-journal') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await writeFile(file, 'corrupt')
    await makeCoordinator({ stateRoot, registry }).recoverPending(); expect(await readFile(file, 'utf8')).toBe('old'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('fails closed for phase-inconsistent, duplicate, incomplete, or mismatched journal evidence and result fields', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const path = join(stateRoot, '.ash', 'adapters', 'journals', `${approved.approval.operationId}.json`); const original = await journalAt(stateRoot, approved.approval.operationId); const mutations: unknown[] = [
      { ...original, phase: 'journaled' },
      { ...original, phase: 'backed-up', backupEntries: [] },
      { ...original, backupEntries: [original.backupEntries[0], original.backupEntries[0]] },
      { ...original, backupEntries: [{ ...original.backupEntries[0], operationEntryId: 'other' }] },
      { ...original, phase: 'applied', result: undefined },
      { ...original, phase: 'applied', result: { ...result(approved), unexpected: 'secret-shaped-data' } },
    ]
    for (const mutation of mutations) { await writeFile(path, JSON.stringify(mutation)); await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/malformed|journal|evidence|result/i); expect(await readFile(file, 'utf8')).toBe('old') }
  })

  it('fails closed when the journal directory contains any unknown entry', async () => {
    const stateRoot = join(await directory(), 'state'); const journals = join(stateRoot, '.ash', 'adapters', 'journals'); await mkdir(journals, { recursive: true }); await writeFile(join(journals, 'README.txt'), 'unexpected')
    await expect(makeCoordinator({ stateRoot, registry: new AdapterRegistry() }).recoverPending()).rejects.toThrow(/unknown|journal.*entry/i)
  })

  it('fails closed for malformed journals and backup destinations', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const stateRoot = join(await directory(), 'state'); const journals = join(stateRoot, '.ash', 'adapters', 'journals'); await mkdir(journals, { recursive: true }); await writeFile(join(journals, 'malformed.json'), '{broken')
    const coordinator = makeCoordinator({ stateRoot, registry: new AdapterRegistry() }); await expect(coordinator.recoverPending()).rejects.toThrow(/malformed|journal/i); expect(await readFile(file, 'utf8')).toBe('old')
    await rm(join(journals, 'malformed.json')); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const target = installation(nativeRoot); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const journal = await journalAt(stateRoot, approved.approval.operationId); const tampered = { ...journal, backupEntries: [{ ...journal.backupEntries[0], backupRelativePath: '../escape' }] }; await writeFile(join(journals, `${approved.approval.operationId}.json`), JSON.stringify(tampered))
    await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/backup|malformed|unsafe/i); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('fails closed when a backup directory contains unjournaled evidence', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); const backupRoot = join(stateRoot, '.ash-backups', 'adapters', approved.approval.operationId); await writeFile(join(backupRoot, 'unexpected.bin'), 'unknown')
    await expect(makeCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/malformed.*journal|backup.*evidence|unknown/i); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('serializes concurrent apply and recovery for the same state root and target', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const events: string[] = []; let resume!: () => void; let entered!: () => void; const gate = new Promise<void>((resolve) => { resume = resolve }); const atApply = new Promise<void>((resolve) => { entered = resolve })
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { events.push('apply-enter'); entered(); await gate; await writeFile(file, 'new'); events.push('apply-exit'); return result(plan) })]); const first = makeCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const second = makeCoordinator({ stateRoot, registry }); const approved = first.approve(await first.planProjection('fixture', selection, target)); const applying = first.apply(approved); await atApply; const recovering = second.recoverPending().then(() => events.push('recover'))
    await Promise.resolve(); expect(events).toEqual(['apply-enter']); resume(); await Promise.all([applying, recovering]); expect(events).toEqual(['apply-enter', 'apply-exit', 'recover'])
  })

  it('serializes one installation across different state roots through the shared coordination root', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const coordinationRoot = join(await directory(), 'coordination'); const stateOne = join(await directory(), 'state-one'); const stateTwo = join(await directory(), 'state-two'); const events: string[] = []; let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve }); let calls = 0
    const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { calls += 1; events.push(`enter-${calls}`); await gate; await writeFile(file, 'new'); events.push(`exit-${calls}`); return result(plan) })]); const first = makeCoordinator({ stateRoot: stateOne, coordinationRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const second = makeCoordinator({ stateRoot: stateTwo, coordinationRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const approvedOne = first.approve(await first.planProjection('fixture', selection, target)); const approvedTwo = second.approve(await second.planProjection('fixture', selection, target))
    const applyingOne = first.apply(approvedOne); while (!events.length) await new Promise<void>((resolve) => setImmediate(resolve)); const applyingTwo = second.apply(approvedTwo); await new Promise((resolve) => setTimeout(resolve, 25)); expect(events).toEqual(['enter-1']); release(); await applyingOne; await expect(applyingTwo).rejects.toThrow(/stale|changed/i); expect(events).toEqual(['enter-1', 'exit-1'])
  })
})
