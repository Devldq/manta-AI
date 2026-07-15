import { AgentStorageProgressSchema, StorageIpcRequestSchema, StorageIpcResponseSchema, type AgentOperationSummary, type AgentPlanPreview, type AgentStorageProgress, type StorageGitImportPlan, type StorageGroupId, type StorageIpcRequest, type StorageIpcResponse, type StorageOperationProgress } from '@manta/shared'

interface IpcMainLike { handle(channel: string, listener: (event: any, request: unknown) => unknown): void; removeHandler(channel: string): void }
interface IpcRendererLike { invoke(channel: string, request?: unknown): Promise<unknown>; on(channel: string, listener: (...args: any[]) => void): void; removeListener(channel: string, listener: (...args: any[]) => void): void }
export interface StartedStorageOperation { operationId: string; completion?: Promise<unknown> }
type StorageOperationStart = string | StartedStorageOperation
type ConfiguredGitBinding = { volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; createdAt: string; updatedAt: string }
export interface StorageIpcServices {
  selectParent(purpose: 'createVolume' | 'migrateVolume', event: any): Promise<string | undefined>
  createVolume(name: string, selectionId: string, event: any): Promise<string>
  relocateVolume(volumeId: string, selectionId: string, event: any): Promise<StorageOperationStart>
  moveGroup(groupId: StorageGroupId, targetVolumeId: string): Promise<StorageOperationStart>
  openVolume(volumeId: string): Promise<void>
  deleteBackup(backupId: string): Promise<void>
  configureGit?(volumeId: string, config: Extract<StorageIpcRequest, { channel: 'storage:configure-git' }>): Promise<ConfiguredGitBinding>
  syncVolume?(volumeId: string): Promise<unknown>
  planGitImport?(volumeId: string): Promise<StorageGitImportPlan>
  applyGitImport?(volumeId: string, input: Pick<Extract<StorageIpcRequest, { channel: 'storage:apply-git-import' }>, 'sessionId' | 'decisions'>): Promise<void>
  agentPlanImport?(adapterId: string, installationId: string, senderId: string): Promise<AgentPlanPreview>
  agentPlanProjection?(adapterId: string, installationId: string, assetIds: readonly string[], senderId: string): Promise<AgentPlanPreview>
  agentApply?(planSessionId: string, senderId: string): Promise<{ operationId: string; result: AgentOperationSummary }>
  agentRollback?(operationId: string): Promise<AgentOperationSummary>
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
      const senderId = String(event.sender?.id ?? '')
      switch (request.channel) {
        case 'storage:select-parent': { const selectionId = await options.services.selectParent(request.purpose, event); response = { ok: true, kind: 'parent-selected', selectionId }; break }
        case 'storage:create-volume': assertId(request.selectionId, 'selectionId'); response = { ok: true, kind: 'volume-created', volumeId: await options.services.createVolume(request.name, request.selectionId, event) }; break
        case 'storage:relocate-volume': assertId(request.volumeId, 'volumeId'); assertId(request.selectionId, 'selectionId'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.relocateVolume(request.volumeId, request.selectionId, event)) }; break
        case 'storage:move-group': assertId(request.targetVolumeId, 'targetVolumeId'); response = { ok: true, kind: 'operation-started', operationId: startedOperation(await options.services.moveGroup(request.groupId, request.targetVolumeId)) }; break
        case 'storage:open-volume': assertId(request.volumeId, 'volumeId'); await options.services.openVolume(request.volumeId); response = { ok: true, kind: 'completed' }; break
        case 'storage:delete-backup': assertId(request.backupId, 'backupId'); await options.services.deleteBackup(request.backupId); response = { ok: true, kind: 'completed' }; break
        case 'storage:configure-git': assertId(request.volumeId, 'volumeId'); if (!options.services.configureGit) throw Object.assign(new Error('Git is unavailable'), { code: 'GIT_UNAVAILABLE' }); response = { ok: true, kind: 'git-configured', binding: await options.services.configureGit(request.volumeId, request) }; break
        case 'storage:sync-volume': assertId(request.volumeId, 'volumeId'); if (!options.services.syncVolume) throw new Error('Sync is unavailable'); await options.services.syncVolume(request.volumeId); response = { ok: true, kind: 'completed' }; break
        case 'storage:plan-git-import': assertId(request.volumeId, 'volumeId'); if (!options.services.planGitImport) throw Object.assign(new Error('Git import is unavailable'), { code: 'GIT_IMPORT_UNAVAILABLE' }); response = { ok: true, kind: 'git-import-plan', plan: await options.services.planGitImport(request.volumeId) }; break
        case 'storage:apply-git-import': assertId(request.volumeId, 'volumeId'); assertId(request.sessionId, 'sessionId'); if (!options.services.applyGitImport) throw Object.assign(new Error('Git import is unavailable'), { code: 'GIT_IMPORT_UNAVAILABLE' }); await options.services.applyGitImport(request.volumeId, { sessionId: request.sessionId, decisions: request.decisions }); response = { ok: true, kind: 'completed' }; break
        case 'storage:agent-plan-import': if (!options.services.agentPlanImport) throw Object.assign(new Error('Agent integration is unavailable'), { code: 'AGENT_INTEGRATION_UNAVAILABLE' }); response = { ok: true, kind: 'agent-plan', plan: await options.services.agentPlanImport(request.adapterId, request.installationId, senderId) }; break
        case 'storage:agent-plan-projection': if (!options.services.agentPlanProjection) throw Object.assign(new Error('Agent integration is unavailable'), { code: 'AGENT_INTEGRATION_UNAVAILABLE' }); response = { ok: true, kind: 'agent-plan', plan: await options.services.agentPlanProjection(request.adapterId, request.installationId, request.assetIds, senderId) }; break
        case 'storage:agent-apply': if (!options.services.agentApply) throw Object.assign(new Error('Agent integration is unavailable'), { code: 'AGENT_INTEGRATION_UNAVAILABLE' }); { const applied = await options.services.agentApply(request.planSessionId, senderId); response = { ok: true, kind: 'agent-applied', ...applied }; break }
        case 'storage:agent-rollback': if (!options.services.agentRollback) throw Object.assign(new Error('Agent integration is unavailable'), { code: 'AGENT_INTEGRATION_UNAVAILABLE' }); response = { ok: true, kind: 'agent-rolled-back', result: await options.services.agentRollback(request.operationId) }; break
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
    subscribeAgentProgress(callback: (progress: AgentStorageProgress) => void) { const listener = (_event: unknown, progress: unknown) => { const parsed = AgentStorageProgressSchema.safeParse(progress); if (parsed.success) callback(parsed.data) }; ipc.on('storage:agent-progress', listener); return () => ipc.removeListener('storage:agent-progress', listener) },
  })
}
