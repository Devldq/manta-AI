import type { StorageIpcRequest, StorageIpcResponse, StorageOperationProgress } from '@manta/shared'
import { StorageIpcRequestSchema } from '@manta/storage-hub'

interface IpcMainLike { handle(channel: string, listener: (event: any, request: unknown) => unknown): void; removeHandler(channel: string): void }
interface IpcRendererLike { invoke(channel: string, request?: unknown): Promise<unknown>; on(channel: string, listener: (...args: any[]) => void): void; removeListener(channel: string, listener: (...args: any[]) => void): void }
export interface StorageIpcServices {
  selectParent(): Promise<string | undefined>
  createVolume(name: string, selectionId: string): Promise<string>
  relocateVolume(volumeId: string, selectionId: string): Promise<string>
  moveGroup(groupId: StorageIpcRequest & any, targetVolumeId: string): Promise<string>
  openVolume(volumeId: string): Promise<void>
  deleteBackup(backupId: string): Promise<void>
  configureGit?(volumeId: string, remoteUrl: string, authRef?: string): Promise<string>
  syncVolume?(volumeId: string): Promise<string>
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
function assertId(value: string, label: string): void { if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}`) }

export function registerStorageIpc(options: { ipcMain: IpcMainLike; trustedOrigin: string; trustedSenderId?: number; services: StorageIpcServices }): () => void {
  const handler = async (event: any, raw: unknown): Promise<StorageIpcResponse> => {
    const actual = new URL(event.senderFrame?.url ?? '')
    if (actual.origin !== new URL(options.trustedOrigin).origin) throw new Error('Untrusted IPC sender')
    if (options.trustedSenderId !== undefined && event.sender?.id !== options.trustedSenderId) throw new Error('Untrusted IPC sender')
    if (event.senderFrame?.top && event.senderFrame.top !== event.senderFrame) throw new Error('Untrusted IPC frame')
    const request = StorageIpcRequestSchema.parse(raw)
    switch (request.channel) {
      case 'storage:select-parent': { const selectionId = await options.services.selectParent(); return { ok: true, selectionId } }
      case 'storage:create-volume': assertId(request.selectionId, 'selectionId'); return { ok: true, operationId: await options.services.createVolume(request.name, request.selectionId) }
      case 'storage:relocate-volume': assertId(request.volumeId, 'volumeId'); assertId(request.selectionId, 'selectionId'); return { ok: true, operationId: await options.services.relocateVolume(request.volumeId, request.selectionId) }
      case 'storage:move-group': assertId(request.targetVolumeId, 'targetVolumeId'); return { ok: true, operationId: await options.services.moveGroup(request.groupId, request.targetVolumeId) }
      case 'storage:open-volume': assertId(request.volumeId, 'volumeId'); await options.services.openVolume(request.volumeId); return { ok: true }
      case 'storage:delete-backup': assertId(request.backupId, 'backupId'); await options.services.deleteBackup(request.backupId); return { ok: true }
      case 'storage:configure-git': assertId(request.volumeId, 'volumeId'); if (!options.services.configureGit) throw new Error('Git is unavailable'); return { ok: true, operationId: await options.services.configureGit(request.volumeId, request.remoteUrl, request.authRef) }
      case 'storage:sync-volume': assertId(request.volumeId, 'volumeId'); if (!options.services.syncVolume) throw new Error('Sync is unavailable'); return { ok: true, operationId: await options.services.syncVolume(request.volumeId) }
    }
  }
  options.ipcMain.handle('storage:invoke', handler)
  return () => options.ipcMain.removeHandler('storage:invoke')
}

export namespace registerStorageIpc {
  export const createRendererBridge = (ipc: IpcRendererLike) => ({
    invoke: (request: StorageIpcRequest) => ipc.invoke('storage:invoke', request) as Promise<StorageIpcResponse>,
    subscribeProgress(callback: (progress: StorageOperationProgress) => void) {
      const listener = (_event: unknown, progress: unknown) => callback(progress as StorageOperationProgress)
      ipc.on('storage:progress', listener); return () => ipc.removeListener('storage:progress', listener)
    },
  })
}
