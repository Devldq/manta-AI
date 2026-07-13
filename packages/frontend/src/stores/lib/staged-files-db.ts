/*
 * The browser owns only a short-lived retry cache.  Canonical queue bytes and
 * batch metadata are stored by the backend in ASH cache/config groups.
 */
import { clientState } from '@/lib/client-state'
import type { ChunkingConfig } from '../rag-detail-store'

export interface PersistedStagedFile { id: string; kbId: string; file: File; name: string; size: number; type: string; relativePath?: string }
export interface BatchMeta { kbId: string; processingStarted: boolean; totalFiles: number; concurrency: number; chunkingConfig: ChunkingConfig; startedAt: string }
type StageEntry = Omit<PersistedStagedFile, 'file'>
const offlineFiles = new Map<string, PersistedStagedFile>()
const endpoint = (kbId: string) => `/api/storage/rag-staging/${encodeURIComponent(kbId)}`

function key(kbId: string, id: string): string { return `${kbId}:${id}` }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' }
function isEntry(value: unknown): value is StageEntry {
  return isRecord(value) && typeof value.id === 'string' && typeof value.kbId === 'string' && typeof value.name === 'string' && typeof value.size === 'number' && typeof value.type === 'string'
}
function responseEntry(body: unknown): StageEntry | undefined {
  if (!isRecord(body) || !isRecord(body.data)) return undefined
  return isEntry(body.data.entry) ? body.data.entry : undefined
}
function responseEntries(body: unknown): StageEntry[] {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.entries)) return []
  return body.data.entries.filter(isEntry)
}
function localFiles(kbId: string): PersistedStagedFile[] { return [...offlineFiles.values()].filter((file) => file.kbId === kbId) }

async function upload(kbId: string, file: PersistedStagedFile): Promise<PersistedStagedFile> {
  const body = new FormData(); body.append('file', file.file, file.name)
  const response = await fetch(endpoint(kbId), { method: 'POST', body, headers: { 'X-Manta-Idempotency-Key': `rag-stage-${file.id}` } })
  if (!response.ok) throw new Error(`RAG staging upload failed: HTTP ${response.status}`)
  const entry = responseEntry(await response.json())
  if (!isEntry(entry)) throw new Error('RAG staging upload returned invalid metadata')
  offlineFiles.delete(key(kbId, file.id))
  return { ...entry, kbId, file: file.file, relativePath: file.relativePath }
}

export async function saveStagedFiles(kbId: string, next: Array<Omit<PersistedStagedFile, 'kbId'>>): Promise<PersistedStagedFile[]> {
  const result: PersistedStagedFile[] = []
  for (const file of next) {
    try { result.push(await upload(kbId, { ...file, kbId })) }
    catch (error) { offlineFiles.set(key(kbId, file.id), { ...file, kbId }); throw error }
  }
  return result
}
export async function loadStagedFiles(kbId: string): Promise<PersistedStagedFile[]> {
  let entries: StageEntry[] = []
  try { const response = await fetch(endpoint(kbId)); if (!response.ok) throw new Error(`RAG staging load failed: HTTP ${response.status}`); entries = responseEntries(await response.json()) } catch { return localFiles(kbId) }
  const restored = await Promise.all(entries.map(async (entry) => {
    const response = await fetch(`${endpoint(kbId)}/${encodeURIComponent(entry.id)}/content`)
    if (!response.ok) throw new Error(`RAG staging content failed: HTTP ${response.status}`)
    const file = new File([await response.blob()], entry.name, { type: entry.type })
    return { ...entry, kbId, file }
  }))
  // A successful list does not prove that a previously failed upload vanished.
  // Retry volatile browser bytes, then present the canonical and recovered rows
  // as one id-deduplicated queue.
  const recovered: PersistedStagedFile[] = []
  for (const local of localFiles(kbId)) {
    try { recovered.push(await upload(kbId, local)) }
    catch { recovered.push(local) }
  }
  return [...new Map([...restored, ...recovered].map((file) => [file.id, file])).values()]
}
export async function claimStagedFiles(kbId: string, ids: string[], sessionId: string): Promise<void> {
  const response = await fetch(`${endpoint(kbId)}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, sessionId }) })
  if (!response.ok) throw new Error(`RAG staging claim failed: HTTP ${response.status}`)
}
export async function removeStagedFileById(id: string, kbId?: string): Promise<void> {
  // Delete the canonical record first.  If the remote write fails, retain the
  // local row so a refresh cannot hide then silently resurrect the item.
  if (kbId) {
    const response = await fetch(`${endpoint(kbId)}/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error(`RAG staging delete failed: HTTP ${response.status}`)
  }
  for (const [cacheKey, file] of offlineFiles) if (file.id === id && (!kbId || file.kbId === kbId)) offlineFiles.delete(cacheKey)
}
export async function clearStagedFilesForKb(kbId: string): Promise<void> { const files = await loadStagedFiles(kbId); await Promise.all(files.map((file) => removeStagedFileById(file.id, kbId))) }
async function loadSessions(): Promise<Record<string, BatchMeta>> { const value = await clientState.load<{ sessions?: Record<string, BatchMeta> }>('rag-batch'); return value?.sessions ?? {} }
export async function saveBatchMeta(meta: BatchMeta): Promise<void> { const sessions = await loadSessions(); if (!(await clientState.set('rag-batch', { sessions: { ...sessions, [meta.kbId]: meta } }))) throw new Error('RAG batch metadata persistence failed') }
export async function loadBatchMeta(kbId: string): Promise<BatchMeta | null> { return (await loadSessions())[kbId] ?? null }
export async function clearBatchMeta(kbId: string): Promise<void> { const sessions = await loadSessions(); delete sessions[kbId]; if (!(await clientState.set('rag-batch', { sessions }))) throw new Error('RAG batch metadata persistence failed') }
export async function clearAllForKb(kbId: string): Promise<void> { await Promise.all([clearStagedFilesForKb(kbId), clearBatchMeta(kbId)]) }
