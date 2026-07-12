import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AshBootstrap, StorageGroupId, StorageOperationProgress } from '@manta/shared'
import { writeJsonAtomic } from '@manta/storage-hub'

export type BackupRef =
  | { kind: 'group'; operationId: string; groupId: StorageGroupId; sourcePath: string; targetPath: string; backupPath: string }
  | { kind: 'volume'; operationId: string; volumeId: string; sourcePath: string; targetPath: string; backupPath: string }
export interface StorageOperationRecord { id: string; kind: 'group' | 'volume'; status: 'running' | 'succeeded' | 'failed' | 'recovering'; phase: string; startedAt: string; updatedAt: string; progress?: StorageOperationProgress; error?: string; backupRefs: BackupRef[] }
export interface RelaunchIntent { schemaVersion: 1; operationId: string; phase: 'awaiting-new-process-health' | 'rolling-back' | 'old-location-retry'; attempt: number; previous: AshBootstrap; current: AshBootstrap; backupRefs: BackupRef[] }
interface Catalog { schemaVersion: 1; operations: StorageOperationRecord[] }

export class StorageControlStore {
  private queue: Promise<unknown> = Promise.resolve()
  readonly catalogPath: string; readonly intentPath: string
  constructor(controlRoot: string) { this.catalogPath = join(controlRoot, 'ash-operation-catalog.json'); this.intentPath = join(controlRoot, 'ash-relaunch-intent.json') }
  private async readCatalog(): Promise<Catalog> { try { const value = JSON.parse(await readFile(this.catalogPath, 'utf8')) as Catalog; return value.schemaVersion === 1 && Array.isArray(value.operations) ? value : { schemaVersion:1, operations:[] } } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion:1, operations:[] }; throw error } }
  private mutate(operation: (catalog: Catalog) => void): Promise<void> { const work = this.queue.then(async () => { const catalog = await this.readCatalog(); operation(catalog); await writeJsonAtomic(this.catalogPath, catalog) }); this.queue = work.catch(() => {}); return work }
  async startOperation(id: string, kind: 'group' | 'volume'): Promise<void> { const now = new Date().toISOString(); await this.mutate((catalog) => { const existing = catalog.operations.find((item) => item.id === id); if (existing) { existing.kind=kind; existing.status='running'; existing.updatedAt=now; return } catalog.operations.push({ id, kind, status:'running', phase:'planned', startedAt:now, updatedAt:now, backupRefs:[] }) }) }
  async recordProgress(progress: StorageOperationProgress): Promise<void> { await this.mutate((catalog) => { const item = catalog.operations.find((value) => value.id === progress.operationId); const now = new Date().toISOString(); if (item) { item.progress=progress; item.phase=progress.phase; item.updatedAt=now } else catalog.operations.push({ id:progress.operationId, kind:'volume', status:'running', phase:progress.phase, startedAt:now, updatedAt:now, progress, backupRefs:[] }) }) }
  async completeOperation(id: string, backupRefs: BackupRef[]): Promise<void> { await this.mutate((catalog) => { const item = catalog.operations.find((value) => value.id === id); if (!item) throw new Error(`Unknown operation ${id}`); item.status='succeeded'; item.phase='completed'; item.updatedAt=new Date().toISOString(); item.backupRefs=backupRefs }) }
  async failOperation(id: string, error: unknown): Promise<void> { await this.mutate((catalog) => { const item = catalog.operations.find((value) => value.id === id); if (!item) throw new Error(`Unknown operation ${id}`); item.status='failed'; item.phase='failed'; item.updatedAt=new Date().toISOString(); item.error=(error as Error).message }) }
  async getOperation(id: string): Promise<StorageOperationRecord | undefined> { await this.queue; return (await this.readCatalog()).operations.find((item) => item.id === id) }
  async listOperations(): Promise<StorageOperationRecord[]> { await this.queue; return (await this.readCatalog()).operations }
  async writeIntent(intent: RelaunchIntent): Promise<void> { await writeJsonAtomic(this.intentPath, intent) }
  async readIntent(): Promise<RelaunchIntent | undefined> { try { const value=JSON.parse(await readFile(this.intentPath,'utf8')) as RelaunchIntent; if (value.schemaVersion !== 1 || value.attempt > 1) throw new Error('Invalid relaunch intent'); return value } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return undefined; throw error } }
  async clearIntent(): Promise<void> { await rm(this.intentPath, { force:true }) }
}
