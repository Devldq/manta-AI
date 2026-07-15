import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

function identity(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string { return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` }

export async function readOrdinarySnapshotNoFollow(path: string): Promise<{ bytes: Buffer; identity: string }> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try { const before = await handle.stat({ bigint: true }); if (!before.isFile()) throw new Error('Codex native asset is not an ordinary file'); const bytes = await handle.readFile(); const after = await handle.stat({ bigint: true }); if (identity(before) !== identity(after)) throw new Error('Codex native asset changed while reading'); return { bytes, identity: `${before.dev.toString(16)}-${before.ino.toString(16)}-${before.birthtimeNs.toString(16)}` } } finally { await handle.close() }
}

export async function readOrdinaryNoFollow(path: string): Promise<Buffer> { return (await readOrdinarySnapshotNoFollow(path)).bytes }

export async function withOrdinaryNoFollowWritable<T>(path: string, operation: (handle: FileHandle) => Promise<T>): Promise<T> {
  const handle = await open(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0))
  try { const before = await handle.stat({ bigint: true }); if (!before.isFile()) throw new Error('Codex projection claim is not an ordinary file'); const result = await operation(handle); await handle.sync(); const after = await handle.stat({ bigint: true }); if (`${before.dev}:${before.ino}:${before.birthtimeNs}` !== `${after.dev}:${after.ino}:${after.birthtimeNs}`) throw new Error('Codex projection replaced its coordinator claim'); return result } finally { await handle.close() }
}
