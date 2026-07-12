import type { StorageGroupId, StorageOperationProgress, StorageVolumeRecord } from '@manta/shared'

export interface StorageVolumeDetails extends StorageVolumeRecord { groups: StorageGroupId[]; inventory: { bytes: number; files: number } }

export interface StorageOverview {
  volumes: StorageVolumeRecord[]
  groups: Array<{ id: StorageGroupId; volumeId: string; path: string; bytes: number; files: number; health: string; description?: string }>
  logicalBytes?: number
  actualBytes?: number
  savingsBytes?: number
  operation?: StorageOperation
}

export interface StorageBackup { id: string; volumeId: string; path: string; bytes?: number; createdAt?: string }
export interface StorageOperation { id: string; phase: string; progress?: StorageOperationProgress; error?: { code: string; message: string } }
export interface StorageApiError extends Error { code: string; details?: unknown }

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function errorFrom(body: any, status: number): StorageApiError {
  const error = new Error(body?.error?.message ?? `Storage request failed (${status})`) as StorageApiError
  error.code = body?.error?.code ?? `HTTP_${status}`
  error.details = body?.error?.details
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
    if (!response.ok || body?.success === false) throw errorFrom(body, response.status)
    return body?.data as T
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
