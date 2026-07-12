/*
 * RAG files are intentionally not persisted in the renderer. The backend's
 * multipart upload route stages them in ASH `cache` and moves verified content
 * to `knowledge`; this short-lived map only preserves UI state in one tab.
 */
import type { ChunkingConfig } from '../rag-detail-store'

export interface PersistedStagedFile { id: string; kbId: string; file: File; name: string; size: number; type: string; relativePath?: string }
export interface BatchMeta { kbId: string; processingStarted: boolean; totalFiles: number; concurrency: number; chunkingConfig: ChunkingConfig; startedAt: string }

const files = new Map<string, PersistedStagedFile>()
const metadata = new Map<string, BatchMeta>()

export async function saveStagedFiles(kbId: string, next: Array<Omit<PersistedStagedFile, 'kbId'>>): Promise<void> {
  for (const [id, item] of files) if (item.kbId === kbId) files.delete(id)
  for (const file of next) files.set(file.id, { ...file, kbId })
}
export async function loadStagedFiles(kbId: string): Promise<PersistedStagedFile[]> { return [...files.values()].filter((file) => file.kbId === kbId) }
export async function removeStagedFileById(id: string): Promise<void> { files.delete(id) }
export async function clearStagedFilesForKb(kbId: string): Promise<void> { for (const [id, item] of files) if (item.kbId === kbId) files.delete(id) }
export async function saveBatchMeta(meta: BatchMeta): Promise<void> { metadata.set(meta.kbId, meta) }
export async function loadBatchMeta(kbId: string): Promise<BatchMeta | null> { return metadata.get(kbId) ?? null }
export async function clearBatchMeta(kbId: string): Promise<void> { metadata.delete(kbId) }
export async function clearAllForKb(kbId: string): Promise<void> { await Promise.all([clearStagedFilesForKb(kbId), clearBatchMeta(kbId)]) }
