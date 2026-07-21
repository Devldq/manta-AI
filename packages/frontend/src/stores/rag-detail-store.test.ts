import { beforeEach, describe, expect, it, vi } from 'vitest'

const staged = vi.hoisted(() => ({
  saveStagedFiles: vi.fn(),
  saveBatchMeta: vi.fn(),
  claimStagedFiles: vi.fn(),
  removeStagedFileById: vi.fn(),
  removeStagedFilesById: vi.fn(),
  loadStagedFiles: vi.fn(),
  loadBatchMeta: vi.fn(),
  clearBatchMeta: vi.fn(),
  clearAllForKb: vi.fn(),
}))

vi.mock('./lib/staged-files-db', () => ({
  saveStagedFiles: staged.saveStagedFiles, loadStagedFiles: staged.loadStagedFiles,
  removeStagedFileById: staged.removeStagedFileById, removeStagedFilesById: staged.removeStagedFilesById,
  clearAllForKb: staged.clearAllForKb, saveBatchMeta: staged.saveBatchMeta, loadBatchMeta: staged.loadBatchMeta,
  clearBatchMeta: staged.clearBatchMeta, claimStagedFiles: staged.claimStagedFiles,
}))

import { useRAGDetailStore } from './rag-detail-store'

const originalActions = {
  processStagedFiles: useRAGDetailStore.getState().processStagedFiles,
  fetchDocuments: useRAGDetailStore.getState().fetchDocuments,
  fetchKnowledgeBase: useRAGDetailStore.getState().fetchKnowledgeBase,
}

const file = (id: string) => ({ id, file: new File(['x'], `${id}.txt`, { type: 'text/plain' }), name: `${id}.txt`, size: 1, type: 'text/plain' })
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }

describe('RAG staged file clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    staged.loadBatchMeta.mockResolvedValue(null)
    staged.saveBatchMeta.mockResolvedValue(undefined)
    staged.claimStagedFiles.mockResolvedValue(undefined)
    staged.clearAllForKb.mockResolvedValue(undefined)
    staged.removeStagedFilesById.mockResolvedValue({ deletedIds: [], failures: [] })
    staged.removeStagedFileById.mockResolvedValue(undefined)
    useRAGDetailStore.setState({
      ...originalActions,
      currentKbId: 'kb-1',
      stagedFiles: [file('a'), file('b')],
      stagedFileProgress: {},
      chunkingConfig: { strategy: 'recursive', chunkSize: 512, overlap: 50, batchConcurrency: 1 },
      batchProcessing: false,
      batchDone: false,
      batchErrors: [],
    })
  })

  it('collapses equal-content selections after canonical staging returns the same hash id', async () => {
    useRAGDetailStore.setState({ stagedFiles: [], stagedFileProgress: {} })
    staged.saveStagedFiles.mockResolvedValue([
      { ...file('a'), id: 'f'.repeat(64), kbId: 'kb-1' },
      { ...file('b'), id: 'f'.repeat(64), kbId: 'kb-1' },
    ])

    useRAGDetailStore.getState().addStagedFiles([file('a').file, file('b').file])
    await flush()

    expect(useRAGDetailStore.getState().stagedFiles).toHaveLength(1)
    expect(useRAGDetailStore.getState().stagedFiles[0]?.id).toBe('f'.repeat(64))
  })

  it('canonicalizes only the newly added files when a queue already exists', async () => {
    const existing = file('existing')
    const canonicalId = '9'.repeat(64)
    useRAGDetailStore.setState({ stagedFiles: [existing], stagedFileProgress: {} })
    staged.saveStagedFiles.mockResolvedValue([{ ...file('new'), id: canonicalId, kbId: 'kb-1' }])

    useRAGDetailStore.getState().addStagedFiles([file('new').file])
    await flush()

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual(['existing', canonicalId])
  })

  it('removes completed content hashes instead of restoring them as pending after batch metadata is gone', async () => {
    const completedHash = 'a'.repeat(64)
    const pendingHash = 'b'.repeat(64)
    staged.loadStagedFiles.mockResolvedValue([
      { ...file('completed'), id: completedHash, kbId: 'kb-1' },
      { ...file('pending'), id: pendingHash, kbId: 'kb-1' },
    ])
    staged.removeStagedFilesById.mockResolvedValue({ deletedIds: [completedHash], failures: [] })
    useRAGDetailStore.setState({
      currentKbId: 'kb-1',
      stagedFiles: [],
      documents: [{ id: 'doc-ready', name: 'completed.txt', type: 'text/plain', size: 1, uploadedAt: '2026-07-21T00:00:00.000Z', status: 'ready', sourceSha256: completedHash }],
    })

    await useRAGDetailStore.getState().restoreBatchSession('kb-1')

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual([pendingHash])
    expect(staged.removeStagedFilesById).toHaveBeenCalledWith('kb-1', [completedHash])
  })

  it('waits for canonical staging ids before starting workers', async () => {
    const canonicalId = 'c'.repeat(64)
    let finishStaging!: (value: any[]) => void
    staged.saveStagedFiles.mockReturnValue(new Promise((resolve) => { finishStaging = resolve }))
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"type":"done"}\n\n', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    useRAGDetailStore.setState({
      currentKbId: 'kb-1',
      stagedFiles: [],
      stagedFileProgress: {},
      fetchDocuments: vi.fn().mockResolvedValue(undefined),
      fetchKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    })

    useRAGDetailStore.getState().addStagedFiles([file('local').file])
    const processing = useRAGDetailStore.getState().processStagedFiles('kb-1')
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()

    finishStaging([{ ...file('local'), id: canonicalId, kbId: 'kb-1' }])
    await processing

    expect(staged.claimStagedFiles).toHaveBeenCalledWith('kb-1', [canonicalId], 'batch-kb-1')
    expect(staged.removeStagedFileById).toHaveBeenCalledWith(canonicalId, 'kb-1')
    expect(useRAGDetailStore.getState().stagedFiles).toEqual([])
    vi.unstubAllGlobals()
  })

  it('restores an interrupted batch by hash when staging sanitized the file name', async () => {
    const readyHash = 'd'.repeat(64)
    const failedHash = 'e'.repeat(64)
    const unseenHash = 'f'.repeat(64)
    staged.loadBatchMeta.mockResolvedValue({
      kbId: 'kb-1', processingStarted: true, totalFiles: 3, concurrency: 1,
      chunkingConfig: { strategy: 'recursive', chunkSize: 512, overlap: 50, batchConcurrency: 1 },
      startedAt: '2026-07-21T00:00:00.000Z',
    })
    staged.loadStagedFiles.mockResolvedValue([
      { ...file('ready_sanitized'), id: readyHash, kbId: 'kb-1' },
      { ...file('failed_sanitized'), id: failedHash, kbId: 'kb-1' },
      { ...file('unseen_sanitized'), id: unseenHash, kbId: 'kb-1' },
    ])
    staged.removeStagedFilesById.mockResolvedValue({ deletedIds: [readyHash], failures: [] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { documents: [
        { id: 'ready', name: 'ready: original.txt', size: 1, status: 'ready', sourceSha256: readyHash },
        { id: 'failed', name: 'failed: original.txt', size: 1, status: 'error', sourceSha256: failedHash },
      ] },
    }), { headers: { 'Content-Type': 'application/json' } })))
    const resume = vi.fn()
    useRAGDetailStore.setState({ currentKbId: 'kb-1', stagedFiles: [], documents: [], processStagedFiles: resume })

    await useRAGDetailStore.getState().restoreBatchSession('kb-1')

    expect(staged.removeStagedFilesById).toHaveBeenCalledWith('kb-1', [readyHash])
    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual([failedHash, unseenHash])
    expect(useRAGDetailStore.getState().batchCompletedCount).toBe(1)
    expect(resume).toHaveBeenCalledWith('kb-1', { alreadyCompleted: 1 })
    vi.unstubAllGlobals()
  })

  it('stops recovery and preserves an explicit error state when document status cannot be loaded', async () => {
    const pendingHash = '8'.repeat(64)
    staged.loadBatchMeta.mockResolvedValue({
      kbId: 'kb-1', processingStarted: true, totalFiles: 1, concurrency: 5,
      chunkingConfig: { strategy: 'recursive', chunkSize: 512, overlap: 50, batchConcurrency: 20 },
      startedAt: '2026-07-21T00:00:00.000Z',
    })
    staged.loadStagedFiles.mockResolvedValue([{ ...file('pending'), id: pendingHash, kbId: 'kb-1' }])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, error: { message: 'fetch failed' } }), { status: 500, headers: { 'Content-Type': 'application/json' } })))
    const resume = vi.fn()
    useRAGDetailStore.setState({ processStagedFiles: resume, stagedFiles: [], documents: [] })

    await useRAGDetailStore.getState().restoreBatchSession('kb-1')

    expect(resume).not.toHaveBeenCalled()
    expect(useRAGDetailStore.getState().batchProcessing).toBe(false)
    expect(useRAGDetailStore.getState().stagedFileProgress[pendingHash]).toMatchObject({ stage: 'error', error: expect.stringContaining('fetch failed') })
    expect(useRAGDetailStore.getState().chunkingConfig.batchConcurrency).toBe(5)
    vi.unstubAllGlobals()
  })

  it('retains failed files as errors instead of resetting them to pending after the batch ends', async () => {
    const failedId = '7'.repeat(64)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: {"type":"error","error":"vector store unavailable"}\n\n', { status: 200 })))
    useRAGDetailStore.setState({
      stagedFiles: [{ ...file('failed'), id: failedId }],
      fetchDocuments: vi.fn().mockResolvedValue(undefined),
      fetchKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    })

    await originalActions.processStagedFiles('kb-1')

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual([failedId])
    expect(useRAGDetailStore.getState().stagedFileProgress[failedId]).toMatchObject({ stage: 'error', error: 'vector store unavailable' })
    expect(useRAGDetailStore.getState().batchDone).toBe(true)
    vi.unstubAllGlobals()
  })

  it('removes each successful file from the visible queue before the whole batch finishes', async () => {
    const firstId = '5'.repeat(64)
    const secondId = '6'.repeat(64)
    let finishSecond!: (response: Response) => void
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n', { status: 200 }))
      .mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    useRAGDetailStore.setState({
      stagedFiles: [{ ...file('first'), id: firstId }, { ...file('second'), id: secondId }],
      fetchDocuments: vi.fn().mockResolvedValue(undefined),
      fetchKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    })

    const processing = originalActions.processStagedFiles('kb-1')
    await flush()

    expect(useRAGDetailStore.getState().stagedFiles.map((value) => value.id)).toEqual([secondId])
    finishSecond(new Response('data: {"type":"error","error":"stop"}\n\n', { status: 200 }))
    await processing
    vi.unstubAllGlobals()
  })

  it('caps persisted and actual batch concurrency at the backend-supported maximum', async () => {
    const files = Array.from({ length: 6 }, (_, index) => ({ ...file(`file-${index}`), id: String(index + 1).repeat(64) }))
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('data: {"type":"done"}\n\n', { status: 200 }))))
    useRAGDetailStore.setState({
      stagedFiles: files,
      chunkingConfig: { strategy: 'recursive', chunkSize: 512, overlap: 50, batchConcurrency: 20 },
      fetchDocuments: vi.fn().mockResolvedValue(undefined),
      fetchKnowledgeBase: vi.fn().mockResolvedValue(undefined),
    })

    await originalActions.processStagedFiles('kb-1')

    expect(staged.saveBatchMeta).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 5, chunkingConfig: expect.objectContaining({ batchConcurrency: 5 }) }))
    vi.unstubAllGlobals()
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
