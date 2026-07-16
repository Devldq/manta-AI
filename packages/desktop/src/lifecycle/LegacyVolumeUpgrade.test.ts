import { mkdir, mkdtemp, readFile, rename, rmdir, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AshBootstrap } from '@manta/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  legacyVolumeUpgradePaths,
  upgradeBootstrapVolumeDirectories,
  volumeRootLockPath,
  withPreparedVolumeRoot,
} from './LegacyVolumeUpgrade'

const GROUPS = ['extensions', 'knowledge', 'work', 'config', 'secrets', 'diagnostics', 'cache'] as const
const now = '2026-01-01T00:00:00.000Z'

async function createLegacyVolume(parentPath: string, volumeId: string, sentinel: string): Promise<void> {
  const root = join(parentPath, '.manta-ai')
  await mkdir(root, { recursive: true })
  for (const group of GROUPS) await mkdir(join(root, group))
  await mkdir(join(root, '.ash-backups'))
  await writeFile(join(root, 'ash-volume.json'), JSON.stringify({
    schemaVersion: 1,
    volumeId,
    name: volumeId,
    state: 'active',
    groups: [...GROUPS],
    generation: 1,
    createdAt: now,
    updatedAt: now,
  }))
  await writeFile(join(root, 'sentinel.txt'), sentinel)
}

function bootstrap(parents: string[]): AshBootstrap {
  const volumes = parents.map((parentPath, index) => ({ id: `volume-${index}`, name: `Volume ${index}`, parentPath, createdAt: now, updatedAt: now }))
  return {
    schemaVersion: 1,
    generation: 1,
    volumes,
    groupAssignments: Object.fromEntries(GROUPS.map((group) => [group, volumes[0]!.id])) as AshBootstrap['groupAssignments'],
  }
}

describe('legacy volume upgrade', () => {
  it('renames a legacy root and verifies the same directory and manifest identities at the current path', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-legacy-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    await createLegacyVolume(parent, 'volume-0', 'preserve-me')
    const [legacyIdentity, legacyManifestIdentity, legacyManifest] = await Promise.all([
      stat(legacyRoot),
      stat(join(legacyRoot, 'ash-volume.json')),
      readFile(join(legacyRoot, 'ash-volume.json'), 'utf8'),
    ])

    await upgradeBootstrapVolumeDirectories(bootstrap([parent]))

    const [currentIdentity, currentManifestIdentity, currentManifest] = await Promise.all([
      stat(currentRoot),
      stat(join(currentRoot, 'ash-volume.json')),
      readFile(join(currentRoot, 'ash-volume.json'), 'utf8'),
    ])
    expect({ dev: currentIdentity.dev, ino: currentIdentity.ino }).toEqual({ dev: legacyIdentity.dev, ino: legacyIdentity.ino })
    expect({ dev: currentManifestIdentity.dev, ino: currentManifestIdentity.ino }).toEqual({ dev: legacyManifestIdentity.dev, ino: legacyManifestIdentity.ino })
    expect(currentManifest).toBe(legacyManifest)
    await expect(readFile(join(currentRoot, 'sentinel.txt'), 'utf8')).resolves.toBe('preserve-me')
    await expect(stat(legacyRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts a rename that committed before reporting an error only after identity verification succeeds', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-rename-error-'))
    await createLegacyVolume(parent, 'volume-0', 'committed-data')
    const renameVolumeRoot = vi.fn(async (source: string, target: string) => {
      await rename(source, target)
      throw Object.assign(new Error('filesystem reported a late error'), { code: 'EIO' })
    })

    await expect(withPreparedVolumeRoot(parent, async (rootPath) => readFile(join(rootPath, 'sentinel.txt'), 'utf8'), {
      expectedVolumeId: 'volume-0',
      renameVolumeRoot,
    })).resolves.toBe('committed-data')

    expect(renameVolumeRoot).toHaveBeenCalledTimes(1)
  })

  it('fails closed before touching either root when legacy and current directories coexist', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-conflict-'))
    await createLegacyVolume(parent, 'volume-0', 'legacy')
    await mkdir(join(parent, 'manta-ai-data'))
    await writeFile(join(parent, 'manta-ai-data', 'sentinel.txt'), 'current')
    await writeFile(volumeRootLockPath(parent), '')

    await expect(upgradeBootstrapVolumeDirectories(bootstrap([parent]))).rejects.toMatchObject({ code: 'LEGACY_VOLUME_CONFLICT' })

    await expect(readFile(join(parent, '.manta-ai', 'sentinel.txt'), 'utf8')).resolves.toBe('legacy')
    await expect(readFile(join(parent, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('current')
  })

  it('uses a read-only fast path for an existing visible root without acquiring the sibling root lock', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-current-fast-path-'))
    await createLegacyVolume(parent, 'volume-0', 'visible-data')
    await rename(join(parent, '.manta-ai'), join(parent, 'manta-ai-data'))
    await writeFile(volumeRootLockPath(parent), '')

    await expect(upgradeBootstrapVolumeDirectories(bootstrap([parent]))).resolves.toBeUndefined()

    await expect(readFile(join(parent, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('visible-data')
    await expect(readFile(volumeRootLockPath(parent), 'utf8')).resolves.toBe('')
  })

  it('reserves the target before rename so a racing creator cannot become a second owner', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-late-target-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    await createLegacyVolume(parent, 'volume-0', 'legacy-data')
    let racingCreateFailed = false

    await expect(withPreparedVolumeRoot(parent, async (root) => readFile(join(root, 'sentinel.txt'), 'utf8'), {
      expectedVolumeId: 'volume-0',
      afterTargetReservation: async () => {
        try { await mkdir(currentRoot) }
        catch (error) {
          expect(error).toMatchObject({ code: 'EEXIST' })
          racingCreateFailed = true
        }
      },
    })).resolves.toBe('legacy-data')

    expect(racingCreateFailed).toBe(true)
    await expect(stat(legacyRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed without removing a reservation that was replaced before rename', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-replaced-reservation-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    await createLegacyVolume(parent, 'volume-0', 'legacy-data')
    let replacementIdentity: Awaited<ReturnType<typeof stat>> | undefined

    await expect(withPreparedVolumeRoot(parent, async () => 'unsafe', {
      expectedVolumeId: 'volume-0',
      afterTargetReservation: async () => {
        await rmdir(currentRoot)
        await mkdir(currentRoot)
        replacementIdentity = await stat(currentRoot)
      },
    })).rejects.toMatchObject({ code: 'LEGACY_VOLUME_CONFLICT' })

    const currentIdentity = await stat(currentRoot)
    expect({ dev: currentIdentity.dev, ino: currentIdentity.ino }).toEqual({ dev: replacementIdentity!.dev, ino: replacementIdentity!.ino })
    await expect(readFile(join(legacyRoot, 'sentinel.txt'), 'utf8')).resolves.toBe('legacy-data')
  })

  it('fails closed without deleting content added to the reservation before rename', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-modified-reservation-'))
    const legacyRoot = join(parent, '.manta-ai')
    const currentRoot = join(parent, 'manta-ai-data')
    await createLegacyVolume(parent, 'volume-0', 'legacy-data')

    await expect(withPreparedVolumeRoot(parent, async () => 'unsafe', {
      expectedVolumeId: 'volume-0',
      afterTargetReservation: async () => writeFile(join(currentRoot, 'foreign.txt'), 'keep-me'),
    })).rejects.toMatchObject({ code: 'LEGACY_VOLUME_CONFLICT' })

    await expect(readFile(join(currentRoot, 'foreign.txt'), 'utf8')).resolves.toBe('keep-me')
    await expect(readFile(join(legacyRoot, 'sentinel.txt'), 'utf8')).resolves.toBe('legacy-data')
  })

  it('uses native Windows path semantics for drive and UNC storage parents', () => {
    expect(legacyVolumeUpgradePaths('C:\\Users\\Link\\Documents')).toEqual({
      flavor: 'windows',
      legacyRoot: 'C:\\Users\\Link\\Documents\\.manta-ai',
      currentRoot: 'C:\\Users\\Link\\Documents\\manta-ai-data',
      lockPath: 'C:\\Users\\Link\\Documents\\.manta-ai-data.root.migration.lock',
    })
    expect(legacyVolumeUpgradePaths('\\\\server\\share\\Documents')).toEqual({
      flavor: 'windows',
      legacyRoot: '\\\\server\\share\\Documents\\.manta-ai',
      currentRoot: '\\\\server\\share\\Documents\\manta-ai-data',
      lockPath: '\\\\server\\share\\Documents\\.manta-ai-data.root.migration.lock',
    })
  })

  it('upgrades every unique volume parent in an existing multi-volume Bootstrap', async () => {
    const first = await mkdtemp(join(tmpdir(), 'ash-preflight-multi-a-'))
    const second = await mkdtemp(join(tmpdir(), 'ash-preflight-multi-b-'))
    await createLegacyVolume(first, 'volume-0', 'first')
    await createLegacyVolume(second, 'volume-1', 'second')

    await upgradeBootstrapVolumeDirectories(bootstrap([first, second]))

    await expect(readFile(join(first, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('first')
    await expect(readFile(join(second, 'manta-ai-data', 'sentinel.txt'), 'utf8')).resolves.toBe('second')
  })

  it('serializes concurrent users of the same parent/root lock', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-concurrent-'))
    let active = 0
    let maximumActive = 0
    const operation = () => withPreparedVolumeRoot(parent, async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 25))
      active -= 1
    })

    await Promise.all([operation(), operation()])

    expect(maximumActive).toBe(1)
  })

  it('breaks a lock whose persisted owner is confirmed dead', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-dead-lock-'))
    const inspectProcess = vi.fn(async (pid: number) => pid === 424242
      ? { alive: false }
      : { alive: true, identity: 'test:self' })
    await writeFile(volumeRootLockPath(parent), JSON.stringify({ token: 'dead', pid: 424242, processIdentity: 'dead:1', createdAt: now }))

    await expect(withPreparedVolumeRoot(parent, async () => 'ready', { inspectProcess })).resolves.toBe('ready')

    expect(inspectProcess).toHaveBeenCalledWith(424242)
  })

  it('fails closed for unknown-owner locks instead of guessing from timestamps', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-unknown-'))
    await writeFile(volumeRootLockPath(parent), '')
    await utimes(volumeRootLockPath(parent), new Date(0), new Date(0))
    await expect(withPreparedVolumeRoot(parent, async () => 'unsafe', { lockWaitMs: 25 })).rejects.toMatchObject({ code: 'VOLUME_ROOT_LOCKED' })
  })

  it('preserves a non-contention lock publication failure instead of wrapping it as held', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-lock-error-'))
    const failure = Object.assign(new Error('filesystem link I/O failure'), { code: 'EIO' })
    const acquireLock = vi.fn(async () => { throw failure })

    await expect(withPreparedVolumeRoot(parent, async () => 'unsafe', { acquireLock })).rejects.toBe(failure)
    expect(acquireLock).toHaveBeenCalledTimes(1)
  })

  it('preserves the primary operation error when lock release also fails', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'ash-preflight-release-'))
    const primary = Object.assign(new Error('primary conflict'), { code: 'PRIMARY' })
    const acquireLock = vi.fn(async () => ({ release: async () => { throw new Error('release failed') } }))

    await expect(withPreparedVolumeRoot(parent, async () => { throw primary }, { acquireLock })).rejects.toBe(primary)
  })
})
