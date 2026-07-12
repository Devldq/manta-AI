import { access, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AshBootstrap, StorageGroupId } from '@manta/shared'
import { BootstrapStore, volumeRoot, writeJsonAtomic } from '@manta/storage-hub'
import { StorageControlStore, type BackupRef, type RelaunchIntent } from './StorageControlStore'

export async function pathExists(path: string): Promise<boolean> { try { await access(path); return true } catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return false; throw error } }
export function buildBackupRefs(id: string, kind: 'volume'|'group', before: AshBootstrap, after: AshBootstrap, value: string): BackupRef[] {
  if (kind==='volume') { const old=before.volumes.find((item)=>item.id===value); const current=after.volumes.find((item)=>item.id===value); if (!old || !current) throw new Error('Relocated volume is missing'); return [{ kind:'volume', operationId:id, volumeId:value, sourcePath:volumeRoot(old.parentPath), targetPath:volumeRoot(current.parentPath), backupPath:volumeRoot(old.parentPath) }] }
  const group=value as StorageGroupId; const old=before.volumes.find((item)=>item.id===before.groupAssignments[group]); const current=after.volumes.find((item)=>item.id===after.groupAssignments[group]); if (!old || !current) throw new Error('Moved group volume is missing'); const sourcePath=join(volumeRoot(old.parentPath),group); return [{ kind:'group', operationId:id, groupId:group, sourcePath, targetPath:join(volumeRoot(current.parentPath),group), backupPath:join(volumeRoot(old.parentPath),'.ash-backups',id,group) }]
}
export async function restoreRelaunchIntent(intent: RelaunchIntent, bootstrapPath: string, controls: StorageControlStore): Promise<void> {
  await controls.writeIntent({ ...intent, phase:'rolling-back', attempt:1 })
  for (const ref of intent.backupRefs) {
    if (ref.kind === 'group') {
      await rm(ref.targetPath, { recursive:true, force:true }); await mkdir(dirname(ref.sourcePath), { recursive:true })
      if (await pathExists(ref.backupPath)) { await rm(ref.sourcePath, { recursive:true, force:true }); await rename(ref.backupPath, ref.sourcePath) }
      else if (!await pathExists(ref.sourcePath)) throw new Error(`Exact backup is missing for ${ref.groupId}`)
    } else await writeJsonAtomic(join(ref.targetPath, 'ash-volume.json'), { schemaVersion:1, volumeId:ref.volumeId, name:intent.current.volumes.find((item)=>item.id===ref.volumeId)?.name ?? ref.volumeId, state:'backup', groups:Object.entries(intent.current.groupAssignments).filter(([,id])=>id===ref.volumeId).map(([id])=>id), generation:intent.current.generation, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() })
  }
  const now = new Date().toISOString()
  for (const volume of intent.previous.volumes) { const groups=Object.entries(intent.previous.groupAssignments).filter(([,id])=>id===volume.id).map(([id])=>id); await writeJsonAtomic(join(volumeRoot(volume.parentPath),'ash-volume.json'), { schemaVersion:1, volumeId:volume.id, name:volume.name, state:groups.length?'active':'archived', groups, generation:intent.previous.generation, createdAt:volume.createdAt, updatedAt:now }) }
  await new BootstrapStore(bootstrapPath).write(intent.previous); await controls.writeIntent({ ...intent, phase:'old-location-retry', attempt:1 })
}
