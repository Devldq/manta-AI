import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCrossGroupBundleResources, readCrossGroupBundle, transactCrossGroupBundle, type CrossGroupParticipant } from './cross-group-bundle'

function roots(base: string): [CrossGroupParticipant, CrossGroupParticipant] {
  return [{ name: 'metadata', root: join(base, 'config') }, { name: 'secret', root: join(base, 'secrets') }]
}

describe('cross-group versioned 2PC', () => {
  it.each(['after-first-prepare', 'after-prepare', 'after-first-apply', 'after-apply', 'after-first-commit'] as const)('recovers a crash at %s without exposing a mixed generation', (phase) => {
    const base = mkdtempSync(join(tmpdir(), 'manta-2pc-')); const participants = roots(base)
    transactCrossGroupBundle(participants, 'record', (tx) => { tx.write('metadata', 'record.json', 'm1'); tx.write('secret', 'record.json', 's1') })
    expect(() => transactCrossGroupBundle(participants, 'record', (tx) => { tx.write('metadata', 'record.json', 'm2'); tx.write('secret', 'record.json', 's2') }, { fault: (at) => { if (at === phase) throw new Error('crash') } })).toThrow('crash')
    const snapshot = readCrossGroupBundle(participants, 'record', (view) => [view.read('metadata', 'record.json'), view.read('secret', 'record.json')])
    expect(snapshot === undefined || snapshot.join(',') === 'm1,s1' || snapshot.join(',') === 'm2,s2').toBe(true)
    expect(snapshot?.[0]?.slice(1)).toBe(snapshot?.[1]?.slice(1))
  })

  it('stores journals and targets only inside their participant root and rejects a symlink escape', () => {
    const base = mkdtempSync(join(tmpdir(), 'manta-2pc-link-')); const participants = roots(base); const outside = join(base, 'outside'); mkdirSync(outside)
    mkdirSync(participants[0].root, { recursive: true }); try { symlinkSync(outside, join(participants[0].root, 'escape'), 'junction') } catch { return }
    expect(() => transactCrossGroupBundle(participants, 'record', (tx) => tx.write('metadata', 'escape/leak', 'x'))).toThrow(/symbolic|reparse|outside|link/i)
    expect(existsSync(join(outside, 'leak'))).toBe(false)
  })

  it('serializes read-patch-commit under both root locks', () => {
    const base = mkdtempSync(join(tmpdir(), 'manta-2pc-lock-')); const participants = roots(base)
    transactCrossGroupBundle(participants, 'record', (tx) => {
      tx.write('metadata', 'a.json', 'a')
      expect(() => transactCrossGroupBundle(participants, 'other', () => undefined)).toThrow(/lock/i)
    })
    expect(readFileSync(join(participants[0].root, 'a.json'), 'utf8')).toBe('a')
  })

  it('recovers pending work before migration and writes only the reopened root', () => {
    const base = mkdtempSync(join(tmpdir(), 'manta-2pc-reopen-')); const participants = roots(base)
    expect(() => transactCrossGroupBundle(participants, 'record', (tx) => { tx.write('metadata', 'record.json', 'new'); tx.write('secret', 'record.json', 'secret') }, { fault: (phase) => { if (phase === 'after-prepare') throw new Error('crash') } })).toThrow('crash')
    const resources = createCrossGroupBundleResources(participants); resources.metadata.checkpoint()
    const next = join(base, 'new-config'); cpSync(participants[0].root, next, { recursive: true }); resources.metadata.close(); resources.metadata.reopen(next); participants[0].root = next
    transactCrossGroupBundle(participants, 'record', (tx) => tx.write('metadata', 'record.json', 'newer'))
    expect(readFileSync(join(next, 'record.json'), 'utf8')).toBe('newer'); expect(readFileSync(join(base, 'config', 'record.json'), 'utf8')).toBe('new')
  })
})
