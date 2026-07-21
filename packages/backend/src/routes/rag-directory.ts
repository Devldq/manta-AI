import type { DocumentMetadata, KnowledgeBaseStats } from '@manta/rag'
import {
  recordKnowledgeBaseDocumentAdded,
  recordKnowledgeBaseDocumentRemoved,
} from '../core/storage/knowledge-base/store'
import { retryContentStoreLease } from '../storage/content-store-lease-retry'

interface RagDirectoryProvider {
  getDocument(documentId: string): Promise<Pick<DocumentMetadata, 'name'> | null>
  removeDocument(knowledgeBaseId: string, documentId: string): Promise<void>
  getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats>
}

export async function recordUploadedRagDocument(
  knowledgeBaseId: string,
  fileName: string,
  counts: Pick<KnowledgeBaseStats, 'documentCount' | 'chunkCount'>,
): Promise<void> {
  const recorded = await retryContentStoreLease(() => recordKnowledgeBaseDocumentAdded(knowledgeBaseId, fileName, counts))
  if (!recorded) {
    throw new Error(`Knowledge base not found while recording document upload: ${knowledgeBaseId}`)
  }
}

export async function removeRagDocumentAndRecordDirectory(
  knowledgeBaseId: string,
  documentId: string,
  provider: RagDirectoryProvider,
): Promise<Pick<DocumentMetadata, 'name'> | null> {
  const document = await provider.getDocument(documentId)
  if (!document) return null
  await provider.removeDocument(knowledgeBaseId, documentId)
  const stats = await provider.getStats(knowledgeBaseId)
  const recorded = await retryContentStoreLease(() => recordKnowledgeBaseDocumentRemoved(knowledgeBaseId, document.name, stats))
  if (!recorded) {
    throw new Error(`Knowledge base not found while recording document deletion: ${knowledgeBaseId}`)
  }
  return document
}
