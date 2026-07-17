import type { DocumentMetadata, KnowledgeBaseStats } from '@manta/rag'
import {
  recordKnowledgeBaseDocumentAdded,
  recordKnowledgeBaseDocumentRemoved,
} from '../core/storage/knowledge-base/store'

interface RagDirectoryProvider {
  getDocument(documentId: string): Promise<Pick<DocumentMetadata, 'name'> | null>
  removeDocument(knowledgeBaseId: string, documentId: string): Promise<void>
  getStats(knowledgeBaseId: string): Promise<KnowledgeBaseStats>
}

export function recordUploadedRagDocument(
  knowledgeBaseId: string,
  fileName: string,
  counts: Pick<KnowledgeBaseStats, 'documentCount' | 'chunkCount'>,
): void {
  if (!recordKnowledgeBaseDocumentAdded(knowledgeBaseId, fileName, counts)) {
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
  if (!recordKnowledgeBaseDocumentRemoved(knowledgeBaseId, document.name, stats)) {
    throw new Error(`Knowledge base not found while recording document deletion: ${knowledgeBaseId}`)
  }
  return document
}
