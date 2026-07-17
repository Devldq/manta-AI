import type { AggregateStorageCapacityMetrics, StorageGroupId, StorageOperationProgress, StorageVolumeCapacityMetrics, StorageVolumeRecord } from '@manta/shared'

export interface StorageVolumeDetails extends StorageVolumeRecord { groups: StorageGroupId[]; inventory: { bytes: number; files: number }; capacity?: StorageVolumeCapacityMetrics }
export interface StorageGitCapability { available: boolean; version?: string; reason?: string }
export interface StorageGitBinding { volumeId: string; mode: 'local' | 'remote'; remoteUrl?: string; credentialRef?: string; includeSecrets?: boolean; lastSyncedGroupHashes?: Partial<Record<StorageGroupId, string>>; lastSyncedAt?: string; lastSyncStatus?: 'succeeded'; createdAt: string; updatedAt: string }

export interface StorageOverview {
  volumes: StorageVolumeRecord[]
  groups: Array<{ id: StorageGroupId; volumeId: string; path: string; bytes: number; files: number; health: string; description?: string }>
  logicalBytes?: number
  actualBytes?: number
  savingsBytes?: number
  inventoryLogicalBytes?: number
  inventoryTotalBytes?: number
  inventoryTotalFiles?: number
  capacity?: AggregateStorageCapacityMetrics
  volumeCapacity?: StorageVolumeCapacityMetrics[]
  volumeHealth?: Record<string, { status: 'healthy' | 'offline' | 'unreadable' | 'conflict'; conflicts: string[]; checkedAt: string; reason?: string }>
  operation?: StorageOperation
  operations?: StorageOperation[]
}

export interface StorageBackup { id: string; operationId?: string; kind?: string; groupId?: string; volumeId?: string; path?: string; bytes: number; createdAt: string }
export interface StorageOperation { id: string; phase: string; status?: 'running' | 'succeeded' | 'failed' | 'recovering' | string; updatedAt?: string; progress?: StorageOperationProgress; error?: { code: string; message: string } | string }
export interface AgentConnectionState { adapters: Array<{ id: string; displayName: string; status: 'detected' | 'not-detected'; installations: Array<{ id: string; displayName: string; nativeRoots: Array<{ id: string; path: string }> }> }>; operations: import('@manta/shared').AgentOperationReadSummary[] }
export interface AgentAssets { inventory: { schemaVersion: 1; installationId: string; assets: Array<{ id: string; kind: string; nativePath: string }> }; portableAssets: Array<{ schemaVersion: 1; id: string; kind: string }> }
export interface AgentReuseMetrics { scanStatus: 'complete' | 'degraded' | 'scanning'; evidenceStatus: 'verified' | 'unavailable'; portableAssetCount: number; logicalImmutableBytes: number | null; uniqueVerifiedObjectBytes: number | null; verifiedSavedBytes: number | null; materializationStrategies?: { clone: number; copy: number } | null; blockers?: Array<{ code: string; detail: string }> }
export interface StorageApiError extends Error { code: string; details?: unknown }

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' }
function errorFrom(body: unknown, status: number): StorageApiError {
  const payload = isRecord(body) && isRecord(body.error) ? body.error : undefined
  const error = new Error(typeof payload?.message === 'string' ? payload.message : `Storage request failed (${status})`) as StorageApiError
  error.code = typeof payload?.code === 'string' ? payload.code : `HTTP_${status}`
  error.details = payload?.details
  return error
}

export function createStorageApi(fetchImpl: Fetch = fetch): {
  overview(): Promise<StorageOverview>
  volumes(): Promise<StorageVolumeDetails[]>
  volume(id: string): Promise<StorageVolumeDetails>
  operation(id: string): Promise<StorageOperation>
  backups(): Promise<StorageBackup[]>
  gitCapabilities(): Promise<StorageGitCapability>
  gitBindings(): Promise<StorageGitBinding[]>
  agents(): Promise<AgentConnectionState>
  agentAssets(adapterId: string, installationId: string): Promise<AgentAssets>
  agentReuse(): Promise<AgentReuseMetrics>
  agentOperation(operationId: string): Promise<import('@manta/shared').AgentOperationReadSummary>
} {
  async function read<T>(path: string): Promise<T> {
    const response = await fetchImpl(path, { headers: { Accept: 'application/json' } })
    const body = await response.json().catch(() => undefined)
    if (!response.ok || (isRecord(body) && body.success === false)) throw errorFrom(body, response.status)
    if (!isRecord(body)) throw errorFrom(body, response.status)
    return body.data as T
  }
  return {
    overview: () => read<StorageOverview>('/api/storage/overview'),
    volumes: async () => (await read<{ volumes: StorageVolumeDetails[] }>('/api/storage/volumes')).volumes,
    volume: async (id) => (await read<{ volume: StorageVolumeDetails }>(`/api/storage/volumes/${encodeURIComponent(id)}`)).volume,
    operation: async (id) => (await read<{ operation: StorageOperation }>(`/api/storage/operations/${encodeURIComponent(id)}`)).operation,
    backups: async () => (await read<{ backups: StorageBackup[] }>('/api/storage/backups')).backups,
    gitCapabilities: () => read<StorageGitCapability>('/api/storage/git/capabilities'),
    gitBindings: async () => (await read<{ bindings: StorageGitBinding[] }>('/api/storage/git/bindings')).bindings,
    agents: () => read<AgentConnectionState>('/api/storage/agents'),
    agentAssets: (adapterId, installationId) => read<AgentAssets>(`/api/storage/agents/${encodeURIComponent(adapterId)}/installations/${encodeURIComponent(installationId)}/assets`),
    agentReuse: () => read<AgentReuseMetrics>('/api/storage/agents/reuse'),
    agentOperation: async (operationId) => (await read<{ operation: import('@manta/shared').AgentOperationReadSummary }>(`/api/storage/agents/operations/${encodeURIComponent(operationId)}`)).operation,
  }
}

export const storageApi = createStorageApi()
