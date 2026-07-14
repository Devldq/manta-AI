import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

function identity(stat: { dev: bigint; ino: bigint; birthtimeNs: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): string { return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` }

export async function readOrdinaryNoFollow(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try { const before = await handle.stat({ bigint: true }); if (!before.isFile()) throw new Error('Codex native asset is not an ordinary file'); const bytes = await handle.readFile(); const after = await handle.stat({ bigint: true }); if (identity(before) !== identity(after)) throw new Error('Codex native asset changed while reading'); return bytes } finally { await handle.close() }
}
