import type { StorageGroupId, StorageOperationProgress, StorageVolumeRecord } from '@manta/shared'

export interface StorageVolumeDetails extends StorageVolumeRecord { groups: StorageGroupId[]; inventory: { bytes: number; files: number } }

export interface StorageOverview {
  volumes: StorageVolumeRecord[]
  groups: Array<{ id: StorageGroupId; volumeId: string; path: string; bytes: number; files: number; health: string; description?: string }>
  logicalBytes?: number
  actualBytes?: number
  savingsBytes?: number
  operation?: StorageOperation
  operations?: StorageOperation[]
}

export interface StorageBackup { id: string; volumeId: string; path: string; bytes?: number; createdAt?: string }
export interface StorageOperation { id: string; phase: string; status?: 'running' | 'succeeded' | 'failed' | 'recovering' | string; updatedAt?: string; progress?: StorageOperationProgress; error?: { code: string; message: string } | string }
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
  }
}

export const storageApi = createStorageApi()
