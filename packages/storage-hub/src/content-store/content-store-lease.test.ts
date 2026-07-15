import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireVolumeContentStoreLeaseSync, withVolumeContentStoreLease } from './content-store-lease'

const roots: string[] = []
async function volume(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'ash-content-lease-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('volume content-store lease', () => {
  it('prevents a second process from acquiring the lock while held', async () => {
    const root = await volume()
    await withVolumeContentStoreLease(root, async () => {
      const lock = join(root, '.ash', 'content-store.lock')
      const child = spawnSync(process.execPath, ['-e', "require('node:fs').openSync(process.argv[1], 'wx')", lock], { encoding: 'utf8' })
      expect(child.status).not.toBe(0); expect(child.stderr).toMatch(/EEXIST/)
    })
  })

  it('keeps a stale or crashed-process lock fail-closed', async () => {
    const root = await volume(); await mkdir(join(root, '.ash')); await writeFile(join(root, '.ash', 'content-store.lock'), 'dead-process\n')
    expect(() => acquireVolumeContentStoreLeaseSync(root)).toThrow(/busy|stale|lock/i)
  })

  it('does not let synchronous transaction writers enter an active async GC lease', async () => {
    const root = await volume()
    await withVolumeContentStoreLease(root, async () => {
      expect(() => acquireVolumeContentStoreLeaseSync(root)).toThrow(/busy|lock/i)
    })
  })

  it('invalidates inherited ownership before a detached child can reenter after release', async () => {
    const root = await volume(); let releaseChild!: () => void; const childGate = new Promise<void>((resolve) => { releaseChild = resolve }); let childEntered = false
    let detached!: Promise<void>
    await withVolumeContentStoreLease(root, async () => {
      detached = (async () => { await childGate; await withVolumeContentStoreLease(root, async () => { childEntered = true }) })()
    })
    let releaseSecond!: () => void; let secondEntered!: () => void
    const entered = new Promise<void>((resolve) => { secondEntered = resolve }); const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })
    const second = withVolumeContentStoreLease(root, async () => { secondEntered(); await secondGate })
    await entered
    try { releaseChild(); await new Promise((resolve) => setTimeout(resolve, 30)); expect(childEntered).toBe(false) }
    finally { releaseSecond(); await second }
    await detached; expect(childEntered).toBe(true)
  })
})
