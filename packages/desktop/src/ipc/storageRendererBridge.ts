import {
  type StorageIpcRequest,
  type StorageIpcResponse,
  type StorageOperationProgress,
} from '@manta/shared'

export interface StorageIpcRenderer {
  invoke(channel: string, request?: unknown): Promise<unknown>
  on(channel: string, listener: (...args: any[]) => void): void
  removeListener(channel: string, listener: (...args: any[]) => void): void
}

export function createStorageRendererBridge(ipc: StorageIpcRenderer) {
  return {
    invoke: (request: StorageIpcRequest) => ipc.invoke('storage:invoke', request) as Promise<StorageIpcResponse>,
    subscribeProgress(callback: (progress: StorageOperationProgress) => void) {
      const listener = (_event: unknown, progress: unknown) => callback(progress as StorageOperationProgress)
      ipc.on('storage:progress', listener)
      return () => ipc.removeListener('storage:progress', listener)
    },
  }
}
