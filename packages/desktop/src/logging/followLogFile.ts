import { open, stat } from 'node:fs/promises'

export type StopFollowingLog = () => void

export async function followLogFile(path: string, write: (chunk: string) => void, intervalMs = 200): Promise<StopFollowingLog> {
  let offset = (await stat(path).catch(() => undefined))?.size ?? 0
  let reading = false
  let stopped = false

  const readAppended = async () => {
    if (reading || stopped) return
    reading = true
    try {
      const size = (await stat(path).catch(() => undefined))?.size
      if (size === undefined) return
      if (size < offset) offset = 0
      if (size === offset) return
      const file = await open(path, 'r')
      try {
        while (!stopped && offset < size) {
          const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - offset))
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
          if (bytesRead === 0) break
          offset += bytesRead
          write(buffer.subarray(0, bytesRead).toString('utf8'))
        }
      } finally { await file.close() }
    } catch { /* The service may create or rotate the log between polls. */ }
    finally { reading = false }
  }

  const timer = setInterval(() => { void readAppended() }, intervalMs)
  timer.unref()
  return () => { stopped = true; clearInterval(timer) }
}
