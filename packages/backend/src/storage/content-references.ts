import { inspectRagAssetTransactions, type RagAssetTransactionRoots } from './rag-asset-transactions'
import { inspectExtensionTransactionJournals } from './extension-transactions'
import { inspectCrossGroupJournals } from './cross-group-bundle'
import type { VerifiedPendingContentReferences } from '@manta/storage-hub'

export interface ContentReferenceBlocker { code: string; path?: string; detail: string }
export interface ContentReferenceInspection { liveHashes: string[]; blockers: ContentReferenceBlocker[] }

export function inspectRagReferences(roots: RagAssetTransactionRoots): ContentReferenceInspection {
  try {
    const records = inspectRagAssetTransactions(roots)
    return { liveHashes: [...new Set(records.map((record) => record.hash))], blockers: records.length ? [{ code: 'rag-pending', detail: `${records.length} pending RAG asset transaction(s)` }] : [] }
  } catch (error) { return { liveHashes: [], blockers: [{ code: 'rag-journal-invalid', detail: error instanceof Error ? error.message : String(error) }] } }
}

export function inspectExtensionBlockers(extensionsRoot: string): ContentReferenceInspection {
  try {
    const active = inspectExtensionTransactionJournals(extensionsRoot).filter((journal) => journal.phase !== 'completed')
    return { liveHashes: [], blockers: active.length ? [{ code: 'extension-pending', detail: `${active.length} pending extension transaction(s)` }] : [] }
  } catch (error) { return { liveHashes: [], blockers: [{ code: 'extension-journal-invalid', detail: error instanceof Error ? error.message : String(error) }] } }
}

export function inspectCrossGroupBlockers(groupRoots: string[]): ContentReferenceInspection {
  try {
    const pending = groupRoots.flatMap((root) => inspectCrossGroupJournals(root)).filter((journal) => journal.phase === 'prepared')
    return { liveHashes: [], blockers: pending.length ? [{ code: 'cross-group-pending', detail: `${pending.length} prepared cross-group transaction(s)` }] : [] }
  } catch (error) { return { liveHashes: [], blockers: [{ code: 'cross-group-journal-invalid', detail: error instanceof Error ? error.message : String(error) }] } }
}

export function createVolumePendingInspector(options: {
  volumeRoot: string; knowledgeRoot: string; extensionsRoot: string; groupRoots: string[]
  migrationPending: () => boolean | Promise<boolean>; gitPending: () => boolean | { blockers: ContentReferenceBlocker[] } | Promise<boolean | { blockers: ContentReferenceBlocker[] }>
}): () => Promise<VerifiedPendingContentReferences> {
  if (typeof options.migrationPending !== 'function' || typeof options.gitPending !== 'function') throw new Error('Migration and Git pending inspectors are required')
  return async () => {
    const rag = inspectRagReferences({ volumeRoot: options.volumeRoot, knowledgeRoot: options.knowledgeRoot })
    const extension = inspectExtensionBlockers(options.extensionsRoot); const crossGroup = inspectCrossGroupBlockers(options.groupRoots)
    const blockers = [...rag.blockers, ...extension.blockers, ...crossGroup.blockers]
    if (await options.migrationPending()) blockers.push({ code: 'migration-pending', detail: 'A volume migration is pending' })
    const git = await options.gitPending()
    if (typeof git === 'boolean') { if (git) blockers.push({ code: 'git-pending', detail: 'A Git sync/import operation is pending' }) } else blockers.push(...git.blockers)
    return { complete: true, liveHashes: rag.liveHashes, blockers }
  }
}
