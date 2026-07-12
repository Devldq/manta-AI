import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BootstrapStore } from '@manta/storage-hub'
import { buildBackupRefs, restoreRelaunchIntent, trustedBackupRefs, validateRelaunchIntent } from './RelaunchRecovery'
import { StorageControlStore, type RelaunchIntent } from './StorageControlStore'

const now='2026-01-01T00:00:00.000Z'
describe('relaunch recovery', () => {
  it('restores only the exact operation backup and never selects a newer unrelated backup by mtime', async () => {
    const root=await mkdtemp(join(tmpdir(),'ash-rollback-')); const a=join(root,'a'); const b=join(root,'b'); const control=join(root,'control'); const bootstrapPath=join(control,'bootstrap.json')
    const previous:any={schemaVersion:1,generation:1,volumes:[{id:'a',name:'A',parentPath:a,createdAt:now,updatedAt:now},{id:'b',name:'B',parentPath:b,createdAt:now,updatedAt:now}],groupAssignments:{extensions:'a',knowledge:'a',work:'a',config:'a',secrets:'a',diagnostics:'a',cache:'a'}}
    const current:any={...previous,generation:2,groupAssignments:{...previous.groupAssignments,work:'b'}}; const refs=buildBackupRefs('exact-op','group',previous,current,'work'); const exact=refs[0] as any
    await mkdir(exact.backupPath,{recursive:true}); await writeFile(join(exact.backupPath,'data.txt'),'exact'); await mkdir(join(a,'.manta-ai','.ash-backups','newer-op','work'),{recursive:true}); await writeFile(join(a,'.manta-ai','.ash-backups','newer-op','work','data.txt'),'wrong'); await mkdir(exact.targetPath,{recursive:true}); await writeFile(join(exact.targetPath,'data.txt'),'target')
    const store=new StorageControlStore(control); const intent={schemaVersion:1,operationId:'exact-op',phase:'awaiting-new-process-health',attempt:0,previous,current,backupRefs:refs} as RelaunchIntent; await store.startOperation('exact-op','group'); await store.completeOperation('exact-op',refs,{previous,current}); await store.writeIntent(intent); await restoreRelaunchIntent(intent,bootstrapPath,store)
    expect(await readFile(join(exact.sourcePath,'data.txt'),'utf8')).toBe('exact'); expect((await new BootstrapStore(bootstrapPath).read())?.generation).toBe(1); expect((await store.readIntent())?.phase).toBe('old-location-retry')
  })

  it('turns a rolled-back volume target into the only backup and never lists the active source', async () => {
    const root=await mkdtemp(join(tmpdir(),'ash-volume-rollback-')); const a=join(root,'a'); const b=join(root,'b'); const control=join(root,'control'); const bootstrapPath=join(control,'bootstrap.json')
    const previous:any={schemaVersion:1,generation:1,volumes:[{id:'a',name:'A',parentPath:a,createdAt:now,updatedAt:now}],groupAssignments:{extensions:'a',knowledge:'a',work:'a',config:'a',secrets:'a',diagnostics:'a',cache:'a'}}
    const current:any={...previous,generation:2,volumes:[{...previous.volumes[0],parentPath:b}]}; const refs=buildBackupRefs('volume-op','volume',previous,current,'a'); const ref=refs[0] as any
    await mkdir(ref.sourcePath,{recursive:true}); await writeFile(join(ref.sourcePath,'active.txt'),'active'); await mkdir(ref.targetPath,{recursive:true}); await writeFile(join(ref.targetPath,'backup.txt'),'backup')
    const store=new StorageControlStore(control); await store.startOperation('volume-op','volume'); await store.completeOperation('volume-op',refs)
    await restoreRelaunchIntent({schemaVersion:1,operationId:'volume-op',phase:'awaiting-new-process-health',attempt:0,previous,current,backupRefs:refs} as RelaunchIntent,bootstrapPath,store)
    const operation=await store.getOperation('volume-op'); expect(operation?.status).toBe('failed'); expect(operation?.phase).toBe('rolled_back'); expect(operation?.backupRefs[0]?.backupPath).toBe(ref.targetPath)
  })

  it('accepts an exact group backup below an otherwise active old volume', async () => {
    const root=await mkdtemp(join(tmpdir(),'ash-group-backup-')); const a=join(root,'a'); const b=join(root,'b');
    const previous:any={schemaVersion:1,generation:1,volumes:[{id:'a',name:'A',parentPath:a,createdAt:now,updatedAt:now},{id:'b',name:'B',parentPath:b,createdAt:now,updatedAt:now}],groupAssignments:{extensions:'a',knowledge:'a',work:'a',config:'a',secrets:'a',diagnostics:'a',cache:'a'}}
    const current:any={...previous,generation:2,groupAssignments:{...previous.groupAssignments,work:'b'}}; const refs=buildBackupRefs('group-backup','group',previous,current,'work')
    const operation:any={id:'group-backup',kind:'group',status:'succeeded',phase:'completed',startedAt:now,updatedAt:now,backupRefs:refs,rollbackContext:{previous,current}}
    expect(await trustedBackupRefs(operation,current)).toEqual(refs)
  })

  it('rejects a relaunch intent whose persisted catalog record does not prove its bootstrap snapshots', async () => {
    const root=await mkdtemp(join(tmpdir(),'ash-forged-intent-')); const a=join(root,'a'); const b=join(root,'b'); const control=join(root,'control')
    const previous:any={schemaVersion:1,generation:1,volumes:[{id:'a',name:'A',parentPath:a,createdAt:now,updatedAt:now},{id:'b',name:'B',parentPath:b,createdAt:now,updatedAt:now}],groupAssignments:{extensions:'a',knowledge:'a',work:'a',config:'a',secrets:'a',diagnostics:'a',cache:'a'}}
    const current:any={...previous,generation:2,groupAssignments:{...previous.groupAssignments,work:'b'}}; const refs=buildBackupRefs('trusted-op','group',previous,current,'work'); const store=new StorageControlStore(control)
    await store.startOperation('trusted-op','group'); await store.completeOperation('trusted-op',refs,{previous,current})
    const victim=join(root,'victim'); await mkdir(victim,{recursive:true}); await writeFile(join(victim,'must-survive.txt'),'safe')
    const forged:any={schemaVersion:1,operationId:'trusted-op',phase:'awaiting-new-process-health',attempt:0,previous:{...previous,volumes:[{...previous.volumes[0],parentPath:victim}]},current,backupRefs:refs}
    await expect(validateRelaunchIntent(forged,current,store)).rejects.toThrow('not trusted')
    expect(await readFile(join(victim,'must-survive.txt'),'utf8')).toBe('safe')
  })
})
