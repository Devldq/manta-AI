import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from './adapter-registry'
import { ProjectionCoordinator, SimulatedAdapterCrash } from './projection-coordinator'
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
    planImport: async () => {
      const { selection: _selection, ...plan } = rawPlan(target, operations)
      return { ...plan, kind: 'import' }
    },
    planProjection: async () => rawPlan(target, operations),
    apply,
  }
}

async function exists(path: string): Promise<boolean> { return access(path).then(() => true, () => false) }
async function journalAt(stateRoot: string, operationId: string): Promise<AdapterJournal> {
  return JSON.parse(await readFile(join(stateRoot, '.ash', 'adapters', 'journals', `${operationId}.json`), 'utf8')) as AdapterJournal
}

describe('ProjectionCoordinator preview and approval', () => {
  it('keeps detect, inspect, import preview, and projection preview read-only', async () => {
    const file = join(await directory('ash-native-'), 'asset.txt'); await writeFile(file, 'old'); const target = installation(dirname(file)); const operations: PreviewFileOperation[] = [{ id: 'read', kind: 'read', rootId: 'home', nativePath: file }]
    const stateRoot = join(await directory('ash-state-parent-'), 'missing-state'); const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, operations)]), now: () => new Date('2026-07-14T00:10:00.000Z') })
    await coordinator.detect('fixture'); await coordinator.inspect('fixture', target); await coordinator.planImport('fixture', target); const plan = await coordinator.planProjection('fixture', selection, target)
    expect(plan.digest).toMatch(/^[a-f0-9]{64}$/); expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.operations)).toBe(true)
    expect(await exists(stateRoot)).toBe(false); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('rejects unapproved, mutated, expired, foreign-adapter, and target-mismatched plans before writing', async () => {
    const nativeRoot = await directory('ash-native-'); const stateRoot = join(await directory('ash-state-parent-'), 'state'); const target = installation(nativeRoot)
    const validOperations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: join(nativeRoot, 'file'), expectedAfterSha256: sha256('new') }]
    const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, validOperations)]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const plan = await coordinator.planProjection('fixture', selection, target)
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
    const stateRoot = join(await directory(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, [operation])]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target)); await writeFile(file, 'changed')
    await expect(coordinator.apply(approved)).rejects.toThrow(/stale|changed/i); expect(await exists(stateRoot)).toBe(false); expect(await readFile(file, 'utf8')).toBe('changed')
  })
})

describe('ProjectionCoordinator path authorization', () => {
  it.each([
    ['relative', (_root: string) => 'relative/file'],
    ['escape', (root: string) => join(root, '..', 'escape.txt')],
    ['NUL', (root: string) => `${join(root, 'file')}\0suffix`],
  ])('rejects %s paths', async (_label, pathFor) => {
    const nativeRoot = await directory('ash-native-'); const target = installation(nativeRoot); const op: PreviewFileOperation = { id: 'bad', kind: 'create', rootId: 'home', nativePath: pathFor(nativeRoot), expectedAfterSha256: sha256('x') }
    const stateRoot = join(await directory(), 'state'); const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([fixtureAdapter(target, [op])]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/path|absolute|root|NUL/i); expect(await exists(stateRoot)).toBe(false)
  })

  it('rejects duplicate/conflicting paths even when disguised under different roots', async () => {
    const nativeRoot = await directory('ash-native-'); const target = { ...installation(nativeRoot), nativeRoots: [{ id: 'one', path: nativeRoot }, { id: 'two', path: nativeRoot }] }; const file = join(nativeRoot, 'same')
    const ops: PreviewFileOperation[] = [{ id: 'one', kind: 'read', rootId: 'one', nativePath: file }, { id: 'two', kind: 'delete', rootId: 'two', nativePath: file }]
    const coordinator = new ProjectionCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, ops)]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/duplicate|conflict|root/i)
  })

  it('rejects symlink or junction ancestors without following them', async () => {
    const nativeRoot = await directory('ash-native-'); const elsewhere = await directory('ash-elsewhere-'); const linked = join(nativeRoot, 'linked')
    await symlink(elsewhere, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const target = installation(nativeRoot); const op: PreviewFileOperation = { id: 'linked', kind: 'create', rootId: 'home', nativePath: join(linked, 'file'), expectedAfterSha256: sha256('x') }
    const coordinator = new ProjectionCoordinator({ stateRoot: join(await directory(), 'state'), registry: new AdapterRegistry([fixtureAdapter(target, [op])]) })
    await expect(coordinator.planProjection('fixture', selection, target)).rejects.toThrow(/link|junction|symbolic/i)
  })
})

describe('ProjectionCoordinator transaction and rollback', () => {
  it('backs up modify/delete files, marks creates absent, commits, and explicitly rolls back byte-for-byte', async () => {
    const nativeRoot = await directory('ash-native-'); const modify = join(nativeRoot, 'modify.txt'); const remove = join(nativeRoot, 'delete.txt'); const create = join(nativeRoot, 'create.txt')
    await writeFile(modify, Buffer.from([0, 1, 2, 255])); await writeFile(remove, 'remove-old')
    const operations: PreviewFileOperation[] = [
      { id: 'modify', kind: 'modify', rootId: 'home', nativePath: modify, expectedAfterSha256: sha256('modified') },
      { id: 'delete', kind: 'delete', rootId: 'home', nativePath: remove },
      { id: 'create', kind: 'create', rootId: 'home', nativePath: create, expectedAfterSha256: sha256('created') },
    ]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(modify, 'modified'); await rm(remove); await writeFile(create, 'created'); return result(plan) })
    const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const plan = await coordinator.planProjection('fixture', selection, target); const committed = await coordinator.apply(coordinator.approve(plan))
    expect(committed.status).toBe('committed'); const journal = await journalAt(stateRoot, committed.operationId); expect(journal.phase).toBe('committed'); expect(journal.backupEntries.map((entry) => entry.priorState).sort()).toEqual(['absent', 'file', 'file'])
    expect(await readdir(join(stateRoot, '.ash-backups', 'adapters', committed.operationId))).toHaveLength(2)
    await coordinator.rollback(committed.operationId)
    expect(await readFile(modify)).toEqual(Buffer.from([0, 1, 2, 255])); expect(await readFile(remove, 'utf8')).toBe('remove-old'); expect(await exists(create)).toBe(false); expect((await journalAt(stateRoot, committed.operationId)).phase).toBe('rolled-back')
    await coordinator.rollback(committed.operationId)
  })

  it('automatically rolls back an adapter throw and verification failure', async () => {
    for (const mode of ['throw', 'verify'] as const) {
      const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const created = join(nativeRoot, 'created'); await writeFile(existing, 'old')
      const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, { id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]
      const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async (plan) => { await writeFile(existing, mode === 'verify' ? 'wrong' : 'new'); await writeFile(created, 'created'); if (mode === 'throw') throw new Error('adapter failed'); return result(plan) })
      const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
      await expect(coordinator.apply(approved)).rejects.toThrow(mode === 'throw' ? /adapter failed/ : /verification/i)
      expect(await readFile(existing, 'utf8')).toBe('old'); expect(await exists(created)).toBe(false); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
    }
  })

  it('never deletes an unrelated file that appeared where an absent marker was recorded', async () => {
    const nativeRoot = await directory('ash-native-'); const created = join(nativeRoot, 'created'); const operations: PreviewFileOperation[] = [{ id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('expected') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const adapter = fixtureAdapter(target, operations, async () => { await writeFile(created, 'unrelated'); throw new Error('adapter failed') }); const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry([adapter]), now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toThrow(/rollback|safe|prove/i); expect(await readFile(created, 'utf8')).toBe('unrelated'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).not.toBe('rolled-back')
  })
})

describe('ProjectionCoordinator crash recovery', () => {
  it.each(['after-journal', 'after-backup-entry', 'before-apply'] as const)('recovers idempotently from %s', async (point) => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(existing, 'new'); return result(plan) })]); const coordinator = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (candidate) => { if (candidate === point) throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const recovery = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:11:00.000Z') }); await recovery.recoverPending(); await recovery.recoverPending()
    expect(await readFile(existing, 'utf8')).toBe('old'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('rolls back a crash thrown during adapter apply', async () => {
    const nativeRoot = await directory('ash-native-'); const existing = join(nativeRoot, 'existing'); const created = join(nativeRoot, 'created'); await writeFile(existing, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: existing, expectedAfterSha256: sha256('new') }, { id: 'create', kind: 'create', rootId: 'home', nativePath: created, expectedAfterSha256: sha256('created') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async () => { await writeFile(existing, 'new'); await writeFile(created, 'created'); throw new SimulatedAdapterCrash('during-apply') })]); const coordinator = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await new ProjectionCoordinator({ stateRoot, registry }).recoverPending()
    expect(await readFile(existing, 'utf8')).toBe('old'); expect(await exists(created)).toBe(false)
  })

  it('finishes commit after adapter apply completed and recovery is repeated', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) })]); const coordinator = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-applied-journal') throw new SimulatedAdapterCrash(point) } }); const approved = coordinator.approve(await coordinator.planProjection('fixture', selection, target))
    await expect(coordinator.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); const recovery = new ProjectionCoordinator({ stateRoot, registry }); await recovery.recoverPending(); await recovery.recoverPending()
    expect(await readFile(file, 'utf8')).toBe('new'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('committed')
  })

  it('automatically rolls back when applied recovery verification fails', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { await writeFile(file, 'new'); return result(plan) })]); const crashing = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'after-applied-journal') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash); await writeFile(file, 'corrupt')
    await new ProjectionCoordinator({ stateRoot, registry }).recoverPending(); expect(await readFile(file, 'utf8')).toBe('old'); expect((await journalAt(stateRoot, approved.approval.operationId)).phase).toBe('rolled-back')
  })

  it('fails closed for phase-inconsistent, duplicate, incomplete, or mismatched journal evidence and result fields', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const path = join(stateRoot, '.ash', 'adapters', 'journals', `${approved.approval.operationId}.json`); const original = await journalAt(stateRoot, approved.approval.operationId); const mutations: unknown[] = [
      { ...original, phase: 'journaled' },
      { ...original, phase: 'backed-up', backupEntries: [] },
      { ...original, backupEntries: [original.backupEntries[0], original.backupEntries[0]] },
      { ...original, backupEntries: [{ ...original.backupEntries[0], operationEntryId: 'other' }] },
      { ...original, phase: 'applied', result: undefined },
      { ...original, phase: 'applied', result: { ...result(approved), unexpected: 'secret-shaped-data' } },
    ]
    for (const mutation of mutations) { await writeFile(path, JSON.stringify(mutation)); await expect(new ProjectionCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/malformed|journal|evidence|result/i); expect(await readFile(file, 'utf8')).toBe('old') }
  })

  it('fails closed when the journal directory contains any unknown entry', async () => {
    const stateRoot = join(await directory(), 'state'); const journals = join(stateRoot, '.ash', 'adapters', 'journals'); await mkdir(journals, { recursive: true }); await writeFile(join(journals, 'README.txt'), 'unexpected')
    await expect(new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry() }).recoverPending()).rejects.toThrow(/unknown|journal.*entry/i)
  })

  it('fails closed for malformed journals and backup destinations', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const stateRoot = join(await directory(), 'state'); const journals = join(stateRoot, '.ash', 'adapters', 'journals'); await mkdir(journals, { recursive: true }); await writeFile(join(journals, 'malformed.json'), '{broken')
    const coordinator = new ProjectionCoordinator({ stateRoot, registry: new AdapterRegistry() }); await expect(coordinator.recoverPending()).rejects.toThrow(/malformed|journal/i); expect(await readFile(file, 'utf8')).toBe('old')
    await rm(join(journals, 'malformed.json')); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const target = installation(nativeRoot); const registry = new AdapterRegistry([fixtureAdapter(target, operations)]); const crashing = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z'), fault: async (point) => { if (point === 'before-apply') throw new SimulatedAdapterCrash(point) } }); const approved = crashing.approve(await crashing.planProjection('fixture', selection, target)); await expect(crashing.apply(approved)).rejects.toBeInstanceOf(SimulatedAdapterCrash)
    const journal = await journalAt(stateRoot, approved.approval.operationId); const tampered = { ...journal, backupEntries: [{ ...journal.backupEntries[0], backupRelativePath: '../escape' }] }; await writeFile(join(journals, `${approved.approval.operationId}.json`), JSON.stringify(tampered))
    await expect(new ProjectionCoordinator({ stateRoot, registry }).recoverPending()).rejects.toThrow(/backup|malformed|unsafe/i); expect(await readFile(file, 'utf8')).toBe('old')
  })

  it('serializes concurrent apply and recovery for the same state root and target', async () => {
    const nativeRoot = await directory('ash-native-'); const file = join(nativeRoot, 'file'); await writeFile(file, 'old'); const operations: PreviewFileOperation[] = [{ id: 'modify', kind: 'modify', rootId: 'home', nativePath: file, expectedAfterSha256: sha256('new') }]; const events: string[] = []; let resume!: () => void; let entered!: () => void; const gate = new Promise<void>((resolve) => { resume = resolve }); const atApply = new Promise<void>((resolve) => { entered = resolve })
    const target = installation(nativeRoot); const stateRoot = join(await directory(), 'state'); const registry = new AdapterRegistry([fixtureAdapter(target, operations, async (plan) => { events.push('apply-enter'); entered(); await gate; await writeFile(file, 'new'); events.push('apply-exit'); return result(plan) })]); const first = new ProjectionCoordinator({ stateRoot, registry, now: () => new Date('2026-07-14T00:10:00.000Z') }); const second = new ProjectionCoordinator({ stateRoot, registry }); const approved = first.approve(await first.planProjection('fixture', selection, target)); const applying = first.apply(approved); await atApply; const recovering = second.recoverPending().then(() => events.push('recover'))
    await Promise.resolve(); expect(events).toEqual(['apply-enter']); resume(); await Promise.all([applying, recovering]); expect(events).toEqual(['apply-enter', 'apply-exit', 'recover'])
  })
})
