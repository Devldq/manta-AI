import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { AshBootstrapSchema, StorageGroupIdSchema, StorageOperationProgressSchema, type AshBootstrap, type StorageGroupId, type StorageOperationProgress } from '@manta/shared'
import { writeJsonAtomic } from '@manta/storage-hub'

const AbsolutePathSchema = z.string().min(1).refine((value) => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value), 'absolute path required')
const OperationIdSchema = z.string().uuid().or(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/))
const GroupBackupRefSchema = z.object({ kind:z.literal('group'), operationId:OperationIdSchema, groupId:StorageGroupIdSchema, sourcePath:AbsolutePathSchema, targetPath:AbsolutePathSchema, backupPath:AbsolutePathSchema }).strict()
const VolumeBackupRefSchema = z.object({ kind:z.literal('volume'), operationId:OperationIdSchema, volumeId:z.string().min(1), sourcePath:AbsolutePathSchema, targetPath:AbsolutePathSchema, backupPath:AbsolutePathSchema }).strict()
export const BackupRefSchema = z.discriminatedUnion('kind',[GroupBackupRefSchema,VolumeBackupRefSchema])
export type BackupRef = z.infer<typeof BackupRefSchema>
const TimestampSchema=z.string().datetime()
const StorageOperationRecordSchema = z.object({ id:OperationIdSchema, kind:z.enum(['group','volume']), status:z.enum(['running','succeeded','failed','recovering']), phase:z.string().min(1), startedAt:TimestampSchema, updatedAt:TimestampSchema, progress:StorageOperationProgressSchema.optional(), error:z.string().optional(), backupRefs:z.array(BackupRefSchema), rollbackContext:z.object({ previous:AshBootstrapSchema, current:AshBootstrapSchema }).strict().optional() }).strict()
export type StorageOperationRecord = z.infer<typeof StorageOperationRecordSchema>
const CatalogSchema = z.object({ schemaVersion:z.literal(1), operations:z.array(StorageOperationRecordSchema) }).strict()
type Catalog = z.infer<typeof CatalogSchema>
const RelaunchIntentSchema = z.object({ schemaVersion:z.literal(1), operationId:OperationIdSchema, phase:z.enum(['awaiting-new-process-health','rolling-back','old-location-retry']), attempt:z.number().int().min(0).max(1), previous:AshBootstrapSchema, current:AshBootstrapSchema, backupRefs:z.array(BackupRefSchema) }).strict()
export type RelaunchIntent = z.infer<typeof RelaunchIntentSchema>

/** A durable JSON catalog with both process-local serialization and a portable mkdir lock. */
export class StorageControlStore {
  private static readonly queues = new Map<string, Promise<unknown>>()
  readonly catalogPath: string; readonly intentPath: string; private readonly lockPath: string
  constructor(private readonly controlRoot: string) { this.catalogPath=join(controlRoot,'ash-operation-catalog.json'); this.intentPath=join(controlRoot,'ash-relaunch-intent.json'); this.lockPath=join(controlRoot,'.ash-control.lock') }
  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.controlRoot,{recursive:true})
    const deadline=Date.now()+15_000
    for (;;) {
      try { await mkdir(this.lockPath); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code!=='EEXIST') throw error
        try { if (Date.now()-(await stat(this.lockPath)).mtimeMs>30_000) await rm(this.lockPath,{recursive:true,force:true}) } catch (statError) { if ((statError as NodeJS.ErrnoException).code!=='ENOENT') throw statError }
        if (Date.now()>=deadline) throw new Error('Timed out waiting for storage control lock')
        await new Promise((resolve)=>setTimeout(resolve,10))
      }
    }
    try { return await operation() } finally { await rm(this.lockPath,{recursive:true,force:true}).catch(()=>{}) }
  }
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const key=this.controlRoot; const prior=StorageControlStore.queues.get(key) ?? Promise.resolve()
    const work=prior.then(()=>this.withFileLock(operation)); StorageControlStore.queues.set(key,work.catch(()=>{})); return work
  }
  private async readCatalog(): Promise<Catalog> { try { return CatalogSchema.parse(JSON.parse(await readFile(this.catalogPath,'utf8'))) } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return {schemaVersion:1,operations:[]}; throw new Error(`Invalid storage operation catalog: ${(error as Error).message}`) } }
  private mutate(operation:(catalog:Catalog)=>void): Promise<void> { return this.serialized(async()=>{ const catalog=await this.readCatalog(); operation(catalog); await writeJsonAtomic(this.catalogPath,catalog) }) }
  async startOperation(id:string,kind:'group'|'volume'):Promise<void> { const now=new Date().toISOString(); await this.mutate((catalog)=>{ const existing=catalog.operations.find((item)=>item.id===id); if(existing){existing.kind=kind;existing.status='running';existing.phase='planned';existing.updatedAt=now;return} catalog.operations.push({id,kind,status:'running',phase:'planned',startedAt:now,updatedAt:now,backupRefs:[]}) }) }
  async recordProgress(progress:StorageOperationProgress):Promise<void> { await this.mutate((catalog)=>{ const item=catalog.operations.find((value)=>value.id===progress.operationId); const now=new Date().toISOString(); if(item){item.progress=progress;item.phase=progress.phase;item.updatedAt=now}else catalog.operations.push({id:progress.operationId,kind:'volume',status:'running',phase:progress.phase,startedAt:now,updatedAt:now,progress,backupRefs:[]}) }) }
  async completeOperation(id:string,backupRefs:BackupRef[],rollbackContext?:{previous:AshBootstrap;current:AshBootstrap}):Promise<void> { await this.mutate((catalog)=>{const item=catalog.operations.find((value)=>value.id===id);if(!item)throw new Error(`Unknown operation ${id}`);item.status='succeeded';item.phase='completed';item.updatedAt=new Date().toISOString();item.backupRefs=BackupRefSchema.array().parse(backupRefs);item.rollbackContext=rollbackContext}) }
  async failOperation(id:string,error:unknown,phase='failed'):Promise<void> { await this.mutate((catalog)=>{const item=catalog.operations.find((value)=>value.id===id);if(!item)throw new Error(`Unknown operation ${id}`);item.status='failed';item.phase=phase;item.updatedAt=new Date().toISOString();item.error=(error as Error).message}) }
  async markRolledBack(id:string,backupRefs:BackupRef[],error:unknown=new Error('New storage location failed health check')):Promise<void> { await this.mutate((catalog)=>{const item=catalog.operations.find((value)=>value.id===id);if(!item)throw new Error(`Unknown operation ${id}`);item.status='failed';item.phase='rolled_back';item.updatedAt=new Date().toISOString();item.error=(error as Error).message;item.backupRefs=BackupRefSchema.array().parse(backupRefs)}) }
  async getOperation(id:string):Promise<StorageOperationRecord|undefined>{ return this.serialized(async()=> (await this.readCatalog()).operations.find((item)=>item.id===id)) }
  async listOperations():Promise<StorageOperationRecord[]>{ return this.serialized(async()=> (await this.readCatalog()).operations) }
  async writeIntent(intent:RelaunchIntent):Promise<void>{ const valid=RelaunchIntentSchema.parse(intent); await this.serialized(()=>writeJsonAtomic(this.intentPath,valid)) }
  async readIntent():Promise<RelaunchIntent|undefined>{ return this.serialized(async()=>{try{return RelaunchIntentSchema.parse(JSON.parse(await readFile(this.intentPath,'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new Error(`Invalid relaunch intent: ${(error as Error).message}`)}}) }
  async clearIntent():Promise<void>{ await this.serialized(()=>rm(this.intentPath,{force:true})) }
  /** Preserve invalid bytes for diagnosis, but never let them drive recovery. */
  async quarantineIntent():Promise<void>{ await this.serialized(async()=>{ try { await rename(this.intentPath,`${this.intentPath}.invalid-${Date.now()}`) } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error } }) }
}
