import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

type Release = () => void
const tails = new Map<string, Promise<void>>()

/** Serializes publishers, full reference scans, quarantine changes, and deletion for one canonical volume root. */
export async function withVolumeContentStoreLease<T>(volumeRoot: string, work: () => Promise<T>): Promise<T> {
  const root = resolve(volumeRoot); const key = root.toLowerCase()
  const previous = tails.get(key) ?? Promise.resolve()
  let release!: Release
  const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
  tails.set(key, current)
  await previous
  let handle: Awaited<ReturnType<typeof open>> | undefined
  const lockPath = resolve(root, '.ash', 'content-store.lock')
  try {
    await mkdir(resolve(root, '.ash'), { recursive: true })
    const ash = await lstat(resolve(root, '.ash')); if (!ash.isDirectory() || ash.isSymbolicLink()) throw new Error('Content-store lease directory is unsafe')
    const deadline = Date.now() + 30_000
    while (!handle) {
      try { handle = await open(lockPath, 'wx'); await handle.writeFile(`${process.pid}\n`) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error; await new Promise((done) => setTimeout(done, 20)) }
    }
    return await work()
  } finally {
    if (handle) { await handle.close(); await unlink(lockPath).catch(() => undefined) }
    release(); if (tails.get(key) === current) tails.delete(key)
  }
}
