import type { StorageGroupId, StorageIpcRequest, StorageIpcResponse, StorageOperationProgress } from '@manta/shared'
import { StorageIpcRequestSchema, StorageIpcResponseSchema } from '@manta/storage-hub'

interface IpcMainLike { handle(channel: string, listener: (event: any, request: unknown) => unknown): void; removeHandler(channel: string): void }
interface IpcRendererLike { invoke(channel: string, request?: unknown): Promise<unknown>; on(channel: string, listener: (...args: any[]) => void): void; removeListener(channel: string, listener: (...args: any[]) => void): void }
export interface StartedStorageOperation { operationId: string; completion?: Promise<unknown> }
type StorageOperationStart = string | StartedStorageOperation
export interface StorageIpcServices {
  selectParent(purpose: 'createVolume' | 'migrateVolume', event: any): Promise<string | undefined>
  createVolume(name: string, selectionId: string, event: any): Promise<string>
  relocateVolume(volumeId: string, selectionId: string, event: any): Promise<StorageOperationStart>
  moveGroup(groupId: StorageGroupId, targetVolumeId: string): Promise<StorageOperationStart>
  openVolume(volumeId: string): Promise<void>
  deleteBackup(backupId: string): Promise<void>
  configureGit?(volumeId: string, config: Extract<StorageIpcRequest, { channel: 'storage:configure-git' }>): Promise<StorageOperationStart>
  syncVolume?(volumeId: string): Promise<StorageOperationStart>
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
function assertId(value: string, label: string): void { if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}`) }
function startedOperation(value: StorageOperationStart): string {
  if (typeof value === 'string') return value
  // A detached completion is intentionally observed here so failed background work
  // never becomes an unhandled rejection in Electron's main process.
  void value.completion?.catch(() => {})
  return value.operationId
}

export function registerStorageIpc(options: { ipcMain: IpcMainLike; trustedOrigin: string; trustedSenderId?: number; services: StorageIpcServices }): () => void {
  const handler = async (event: any, raw: unknown): Promise<StorageIpcResponse> => {
    try {
      const actual = new URL(event.senderFrame?.url ?? '')
      if (actual.origin !== new URL(options.trustedOrigin).origin) throw Object.assign(new Error('Untrusted IPC sender'), { code: 'UNTRUSTED_SENDER' })
      if (options.trustedSenderId !== undefined && event.sender?.id !== options.trustedSenderId) throw Object.assign(new Error('Untrusted IPC sender'), { code: 'UNTRUSTED_SENDER' })
      if (event.senderFrame?.top && event.senderFrame.top !== event.senderFrame) throw Object.assign(new Error('Untrusted IPC frame'), { code: 'UNTRUSTED_FRAME' })
      const request = StorageIpcRequestSchema.parse(raw); let response: StorageIpcResponse
      switch (request.channel) {
        case 'storage:select-parent': { const selectionId = await options.services.selectParent(request.purpose, event); response = { ok: true, kind: 'parent-selected', selectionId }; break }
        case 'storage:create-volume': assertId(request.selectionId, 'selectionId'); response = { ok: true, kind: 'volume-created', volumeId: await options.services.createVolume(request.name, request.selectionId, event) }; break
        case 'storage:relocate-volume': assertId(request.volumeId, 'volumeId'); assertId(request.selectionId, 'selectionId'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.relocateVolume(request.volumeId, request.selectionId, event)) }; break
        case 'storage:move-group': assertId(request.targetVolumeId, 'targetVolumeId'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.moveGroup(request.groupId, request.targetVolumeId)) }; break
        case 'storage:open-volume': assertId(request.volumeId, 'volumeId'); await options.services.openVolume(request.volumeId); response = { ok: true, kind: 'completed' }; break
        case 'storage:delete-backup': assertId(request.backupId, 'backupId'); await options.services.deleteBackup(request.backupId); response = { ok: true, kind: 'completed' }; break
        case 'storage:configure-git': assertId(request.volumeId, 'volumeId'); if (!options.services.configureGit) throw new Error('Git is unavailable'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.configureGit(request.volumeId, request)) }; break
        case 'storage:sync-volume': assertId(request.volumeId, 'volumeId'); if (!options.services.syncVolume) throw new Error('Sync is unavailable'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.syncVolume(request.volumeId)) }; break
      }
      return StorageIpcResponseSchema.parse(response)
    } catch (error) {
      const validation = (error as any)?.name === 'ZodError' && Array.isArray((error as any).issues)
      const code = validation ? 'INVALID_REQUEST' : (error as any).code ?? 'STORAGE_OPERATION_FAILED'
      const details = validation ? { issues: (error as any).issues } : undefined
      return StorageIpcResponseSchema.parse({ ok: false, error: { code, message: (error as Error).message || 'Storage operation failed', details } })
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
