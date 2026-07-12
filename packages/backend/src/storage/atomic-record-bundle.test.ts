import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverAtomicBundle, writeAtomicBundle, withAtomicBundle } from './atomic-record-bundle'

describe('atomic config/secrets bundles', () => {
  it('recovers an interrupted multi-file commit by rolling forward every member', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-bundle-')); const a = join(root, 'config.json'); const b = join(root, 'secret.json')
    writeFileSync(a, 'old-a'); writeFileSync(b, 'old-b')
    expect(() => writeAtomicBundle({ coordinatorPath: join(root, 'bundle'), writes: new Map([[a, 'new-a'], [b, 'new-b']]), fault: (phase) => { if (phase === 'after-first-write') throw new Error('crash') } })).toThrow('crash')
    recoverAtomicBundle(join(root, 'bundle'))
    expect(readFileSync(a, 'utf8')).toBe('new-a'); expect(readFileSync(b, 'utf8')).toBe('new-b')
  })

  it('rejects a concurrent writer through a cross-instance file lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-bundle-lock-')); const coordinatorPath = join(root, 'bundle'); const file = join(root, 'value')
    expect(() => writeAtomicBundle({ coordinatorPath, writes: new Map([[file, 'x']]), fault: (phase) => {
      if (phase === 'locked') expect(() => writeAtomicBundle({ coordinatorPath, writes: new Map([[file, 'y']]) })).toThrow(/lock/i)
    } })).not.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('x'); expect(existsSync(`${coordinatorPath}.lock`)).toBe(false)
  })

  it('performs consistent read-patch-commit under one authority lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-bundle-api-')); writeFileSync(join(root, 'record.json'), '{"a":1}')
    withAtomicBundle(root, 'record', (bundle) => {
      expect(JSON.parse(bundle.read('record.json')!)).toEqual({ a: 1 })
      expect(() => withAtomicBundle(root, 'other', () => undefined)).toThrow(/lock/i)
      bundle.write('record.json', '{"a":2}')
    })
    expect(JSON.parse(readFileSync(join(root, 'record.json'), 'utf8'))).toEqual({ a: 2 })
  })

  it('rejects a tampered journal path outside its authority root', () => {
    const root = mkdtempSync(join(tmpdir(), 'manta-bundle-tamper-'))
    expect(() => withAtomicBundle(root, 'record', (bundle) => { bundle.write('record.json', 'new') }, { fault: (phase) => { if (phase === 'after-first-write') throw new Error('fault') } })).toThrow('fault')
    const journal = join(root, '.ash-bundles', 'record.journal.json'); const data = JSON.parse(readFileSync(journal, 'utf8')); data.writes[0].path = '../outside'; writeFileSync(journal, JSON.stringify(data))
    expect(() => withAtomicBundle(root, 'record', () => undefined)).toThrow(/journal|path/i)
    expect(existsSync(join(root, '..', 'outside'))).toBe(false)
  })
})
