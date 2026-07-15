import type { StorageGroupId } from '@manta/shared'

export interface StorageLease { release(): void }
type Mode = 'read' | 'write' | 'exclusive'
interface Request { groups: Set<StorageGroupId>; mode: Mode; resolve: (lease: StorageLease) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout; active: boolean }

export class StorageLeaseManager {
  private readonly active = new Set<Request>()
  private readonly queue: Request[] = []

  acquireRead(group: StorageGroupId): Promise<StorageLease> { return this.acquire([group], 'read') }
  acquireWrite(group: StorageGroupId): Promise<StorageLease> { return this.acquire([group], 'write') }
  acquireExclusive(groups: StorageGroupId[], options: { timeoutMs?: number } = {}): Promise<StorageLease> { return this.acquire(groups, 'exclusive', options.timeoutMs) }

  private acquire(groups: StorageGroupId[], mode: Mode, timeoutMs?: number): Promise<StorageLease> {
    return new Promise((resolve, reject) => {
      const request: Request = { groups: new Set(groups), mode, resolve, reject, active: false }
      if (timeoutMs !== undefined) request.timer = setTimeout(() => {
        const index = this.queue.indexOf(request)
        if (index >= 0) this.queue.splice(index, 1)
        reject(new Error('Storage lease timed out'))
        this.drain()
      }, timeoutMs)
      this.queue.push(request)
      this.drain()
    })
  }

  private intersects(left: Request, right: Request): boolean { return [...left.groups].some((group) => right.groups.has(group)) }
  private conflicts(left: Request, right: Request): boolean {
    if (!this.intersects(left, right)) return false
    return left.mode === 'exclusive' || right.mode === 'exclusive' || (left.mode === 'write' && right.mode === 'write')
  }

  private drain(): void {
    for (let index = 0; index < this.queue.length;) {
      const request = this.queue[index]
      const blockedByActive = [...this.active].some((active) => this.conflicts(active, request))
      const blockedByEarlier = this.queue.slice(0, index).some((earlier) => this.conflicts(earlier, request))
      if (blockedByActive || blockedByEarlier) { index += 1; continue }
      this.queue.splice(index, 1); if (request.timer) clearTimeout(request.timer); request.active = true; this.active.add(request)
      let released = false
      request.resolve({ release: () => { if (released) return; released = true; request.active = false; this.active.delete(request); this.drain() } })
    }
  }
}
