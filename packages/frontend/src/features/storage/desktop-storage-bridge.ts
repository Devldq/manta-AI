import type { AgentStorageProgress, StorageIpcRequest, StorageIpcResponse, StorageOperationProgress } from '@manta/shared'

export type StorageIpcSuccess = Extract<StorageIpcResponse, { ok: true }>

export interface DesktopStorageBridge { invoke(request: StorageIpcRequest): Promise<StorageIpcResponse>; subscribeProgress(callback: (value: StorageOperationProgress) => void): () => void; subscribeAgentProgress?(callback: (value: AgentStorageProgress) => void): () => void }
export function desktopStorageBridge(): DesktopStorageBridge | undefined { return window.mantaDesktop?.storage }

export async function invokeStorage(request: StorageIpcRequest): Promise<StorageIpcSuccess> {
  const bridge = desktopStorageBridge()
  if (!bridge) throw Object.assign(new Error('Storage management is available in the desktop app.'), { code: 'DESKTOP_UNAVAILABLE' })
  const result = await bridge.invoke(request)
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, details: result.error.details })
  return result
}
