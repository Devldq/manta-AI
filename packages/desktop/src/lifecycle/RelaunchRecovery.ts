import { access, mkdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { AshBootstrap, StorageGroupId } from '@manta/shared'
import { BootstrapStore, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'
import { StorageControlStore, type BackupRef, type RelaunchIntent, type StorageOperationRecord } from './StorageControlStore'

export async function pathExists(path:string):Promise<boolean>{try{await access(path);return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}}
const samePath=(left:string,right:string)=>process.platform==='win32'?resolve(left).toLowerCase()===resolve(right).toLowerCase():resolve(left)===resolve(right)
const contains=(parent:string,child:string)=>{const value=relative(resolve(parent),resolve(child));return value===''||(!value.startsWith('..')&&!value.includes(':'))}
async function canonical(path:string):Promise<string>{try{return await realpath(path)}catch{return resolve(path)}}
async function intersectsActive(candidate:string,activeRoots:string[]):Promise<boolean>{const actual=await canonical(candidate);for(const root of activeRoots){const canonicalRoot=await canonical(root);if(contains(canonicalRoot,actual)||contains(actual,canonicalRoot))return true}return false}

export function buildBackupRefs(id:string,kind:'volume'|'group',before:AshBootstrap,after:AshBootstrap,value:string):BackupRef[]{
  if(kind==='volume'){const old=before.volumes.find((item)=>item.id===value);const current=after.volumes.find((item)=>item.id===value);if(!old||!current)throw new Error('Relocated volume is missing');return[{kind:'volume',operationId:id,volumeId:value,sourcePath:volumeRoot(old.parentPath),targetPath:volumeRoot(current.parentPath),backupPath:volumeRoot(old.parentPath)}]}
  const group=value as StorageGroupId;const old=before.volumes.find((item)=>item.id===before.groupAssignments[group]);const current=after.volumes.find((item)=>item.id===after.groupAssignments[group]);if(!old||!current)throw new Error('Moved group volume is missing');const sourcePath=join(volumeRoot(old.parentPath),group);return[{kind:'group',operationId:id,groupId:group,sourcePath,targetPath:join(volumeRoot(current.parentPath),group),backupPath:join(volumeRoot(old.parentPath),'.ash-backups',id,group)}]
}

/** Re-derive persisted paths from trusted Bootstrap snapshots; never grant I/O authority to catalog JSON. */
export async function trustedBackupRefs(operation:StorageOperationRecord,active:AshBootstrap):Promise<BackupRef[]>{
  const context=operation.rollbackContext;if(!context)return[]
  const refs=operation.backupRefs.flatMap((stored)=>{const value=stored.kind==='group'?stored.groupId:stored.volumeId;const expected=buildBackupRefs(operation.id,stored.kind,context.previous,context.current,value)[0];if(!expected||stored.operationId!==expected.operationId||stored.kind!==expected.kind||!samePath(stored.sourcePath,expected.sourcePath)||!samePath(stored.targetPath,expected.targetPath))return[]
    if(active.generation===context.current.generation){if(!samePath(stored.backupPath,expected.backupPath))return[];return[expected]}
    if(active.generation===context.previous.generation&&stored.kind==='volume'&&samePath(stored.backupPath,expected.targetPath))return[{...expected,backupPath:expected.targetPath}]
    return[]
  })
  const activeRoots=active.volumes.map((volume)=>volumeRoot(volume.parentPath));return(await Promise.all(refs.map(async(ref)=>(await intersectsActive(ref.backupPath,activeRoots))?undefined:ref))).filter((value):value is BackupRef=>Boolean(value))
}

export async function assertDeletableBackup(ref:BackupRef,active:AshBootstrap):Promise<void>{
  const safe=await trustedBackupRefs({id:ref.operationId,kind:ref.kind,status:'succeeded',phase:'completed',startedAt:new Date(0).toISOString(),updatedAt:new Date(0).toISOString(),backupRefs:[ref],rollbackContext:undefined},active).catch(()=>[])
  // The caller always obtains ref from trustedBackupRefs. This second check independently rejects active roots and aliases.
  if(await intersectsActive(ref.backupPath,active.volumes.map((volume)=>volumeRoot(volume.parentPath))))throw new Error('Refusing to delete an active storage root')
  if(safe.length>1) throw new Error('Invalid backup reference')
}

export async function restoreRelaunchIntent(intent:RelaunchIntent,bootstrapPath:string,controls:StorageControlStore):Promise<void>{
  await controls.writeIntent({...intent,phase:'rolling-back',attempt:1})
  const rollbackRefs:BackupRef[]=[]
  for(const ref of intent.backupRefs){
    const expected=buildBackupRefs(intent.operationId,ref.kind,intent.previous,intent.current,ref.kind==='group'?ref.groupId:ref.volumeId)[0]
    if(!expected||!samePath(ref.sourcePath,expected.sourcePath)||!samePath(ref.targetPath,expected.targetPath)||!samePath(ref.backupPath,expected.backupPath))throw new Error('Relaunch intent backup reference is not derived from Bootstrap')
    if(ref.kind==='group'){
      await rm(expected.targetPath,{recursive:true,force:true});await mkdir(dirname(expected.sourcePath),{recursive:true})
      if(await pathExists(expected.backupPath)){await rm(expected.sourcePath,{recursive:true,force:true});await rename(expected.backupPath,expected.sourcePath)}else if(!await pathExists(expected.sourcePath))throw new Error(`Exact backup is missing for ${ref.groupId}`)
    }else{
      await writeJsonAtomic(join(expected.targetPath,'ash-volume.json'),{schemaVersion:1,volumeId:ref.volumeId,name:intent.current.volumes.find((item)=>item.id===ref.volumeId)?.name??ref.volumeId,state:'backup',groups:Object.entries(intent.current.groupAssignments).filter(([,id])=>id===ref.volumeId).map(([id])=>id),generation:intent.current.generation,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});rollbackRefs.push({...expected,backupPath:expected.targetPath})
    }
  }
  const now=new Date().toISOString();for(const volume of intent.previous.volumes){const groups=Object.entries(intent.previous.groupAssignments).filter(([,id])=>id===volume.id).map(([id])=>id);await writeJsonAtomic(join(volumeRoot(volume.parentPath),'ash-volume.json'),{schemaVersion:1,volumeId:volume.id,name:volume.name,state:groups.length?'active':'archived',groups,generation:intent.previous.generation,createdAt:volume.createdAt,updatedAt:now})}
  await new BootstrapStore(bootstrapPath).write(intent.previous);await controls.markRolledBack(intent.operationId,rollbackRefs);await controls.writeIntent({...intent,backupRefs:rollbackRefs,phase:'old-location-retry',attempt:1})
}
