import { beforeEach, describe, expect, it, vi } from 'vitest'

const staged = vi.hoisted(() => ({
  removeStagedFilesById: vi.fn(),
  loadStagedFiles: vi.fn(),
  clearBatchMeta: vi.fn(),
}))

vi.mock('./lib/staged-files-db', () => ({
  saveStagedFiles: vi.fn(), loadStagedFiles: staged.loadStagedFiles,
  removeStagedFileById: vi.fn(), removeStagedFilesById: staged.removeStagedFilesById,
  clearAllForKb: vi.fn(), saveBatchMeta: vi.fn(), loadBatchMeta: vi.fn(),
  clearBatchMeta: staged.clearBatchMeta, claimStagedFiles: vi.fn(),
}))

import { useRAGDetailStore } from './rag-detail-store'

const file = (id: string) => ({ id, file: new File(['x'], `${id}.txt`, { type: 'text/plain' }), name: `${id}.txt`, size: 1, type: 'text/plain' })
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe('RAG staged file clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRAGDetailStore.setState({ currentKbId: 'kb-1', stagedFiles: [file('a'), file('b')], stagedFileProgress: {} })
  })

  it('keeps failed canonical deletes visible, marks them retryable, and merges a reload after partial failure', async () => {
    staged.removeStagedFilesById.mockResolvedValue({ deletedIds: ['a'], failures: [{ id: 'b', error: new Error('offline') }] })
    staged.loadStagedFiles.mockResolvedValue([{ ...file('b'), kbId: 'kb-1' }, { ...file('c'), kbId: 'kb-1' }])

    useRAGDetailStore.getState().clearStagedFiles()
    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual(['a', 'b'])
    await flush()

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id).sort()).toEqual(['b', 'c'])
    expect(useRAGDetailStore.getState().stagedFileProgress.b).toMatchObject({ stage: 'error', error: 'offline' })
    expect(staged.loadStagedFiles).toHaveBeenCalledWith('kb-1')
    expect(staged.clearBatchMeta).not.toHaveBeenCalled()
  })

  it('retains every file when all canonical deletes fail and reloads the queue for retry', async () => {
    staged.removeStagedFilesById.mockResolvedValue({ deletedIds: [], failures: [{ id: 'a', error: new Error('offline') }, { id: 'b', error: new Error('offline') }] })
    staged.loadStagedFiles.mockResolvedValue([{ ...file('a'), kbId: 'kb-1' }, { ...file('b'), kbId: 'kb-1' }])

    useRAGDetailStore.getState().clearStagedFiles()
    await flush()

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id).sort()).toEqual(['a', 'b'])
    expect(useRAGDetailStore.getState().stagedFileProgress.a).toMatchObject({ stage: 'error' })
    expect(useRAGDetailStore.getState().stagedFileProgress.b).toMatchObject({ stage: 'error' })
    expect(staged.loadStagedFiles).toHaveBeenCalledWith('kb-1')
  })
})
