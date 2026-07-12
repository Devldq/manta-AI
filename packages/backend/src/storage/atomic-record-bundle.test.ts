import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { recoverAtomicBundle, writeAtomicBundle } from './atomic-record-bundle'

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
})
