/* IndexedDB 持久化模块 —— 暂存文件队列 + 批处理元数据
 * 用于刷新页面后恢复未完成的批量处理任务
 */

import type { ChunkingConfig } from '../rag-detail-store'

const DB_NAME = 'manta-rag-staged'
const DB_VERSION = 1
const FILES_STORE = 'files'
const META_STORE = 'meta'

/** 持久化的暂存文件（File 对象可直接存入 IndexedDB） */
export interface PersistedStagedFile {
  id: string
  kbId: string
  file: File
  name: string
  size: number
  type: string
  relativePath?: string
}

/** 批处理元数据 */
export interface BatchMeta {
  kbId: string
  processingStarted: boolean
  totalFiles: number
  concurrency: number
  chunkingConfig: ChunkingConfig
  startedAt: string
}

// ── IndexedDB 连接 ──────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'kbId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// ── 辅助：包装 IDB 请求为 Promise ───────────────────────────────

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 等待事务完成 */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// ── 暂存文件 CRUD ───────────────────────────────────────────────

/** 保存所有暂存文件（先清除该 kbId 的旧文件，再写入新的） */
export async function saveStagedFiles(
  kbId: string,
  files: { id: string; file: File; name: string; size: number; type: string; relativePath?: string }[]
): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(FILES_STORE, 'readwrite')
  const store = tx.objectStore(FILES_STORE)

  // 先删除该 kbId 的所有旧文件
  const all = await reqToPromise(store.getAll())
  for (const item of all as PersistedStagedFile[]) {
    if (item.kbId === kbId) {
      store.delete(item.id)
    }
  }

  // 写入新文件
  for (const f of files) {
    store.add({ ...f, kbId } as PersistedStagedFile)
  }

  await txDone(tx)
}

/** 加载该 kbId 的所有暂存文件 */
export async function loadStagedFiles(kbId: string): Promise<PersistedStagedFile[]> {
  const db = await openDB()
  const tx = db.transaction(FILES_STORE, 'readonly')
  const store = tx.objectStore(FILES_STORE)
  const all = await reqToPromise(store.getAll())
  return (all as PersistedStagedFile[]).filter((f) => f.kbId === kbId)
}

/** 删除单个暂存文件 */
export async function removeStagedFileById(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(FILES_STORE, 'readwrite')
  tx.objectStore(FILES_STORE).delete(id)
  await txDone(tx)
}

/** 清除该 kbId 的所有暂存文件 */
export async function clearStagedFilesForKb(kbId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(FILES_STORE, 'readwrite')
  const store = tx.objectStore(FILES_STORE)
  const all = await reqToPromise(store.getAll())
  for (const item of all as PersistedStagedFile[]) {
    if (item.kbId === kbId) {
      store.delete(item.id)
    }
  }
  await txDone(tx)
}

// ── 批处理元数据 ───────────────────────────────────────────────

/** 保存批处理元数据 */
export async function saveBatchMeta(meta: BatchMeta): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).put(meta)
  await txDone(tx)
}

/** 加载批处理元数据 */
export async function loadBatchMeta(kbId: string): Promise<BatchMeta | null> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readonly')
  const result = await reqToPromise(tx.objectStore(META_STORE).get(kbId))
  return (result as BatchMeta | undefined) ?? null
}

/** 清除批处理元数据 */
export async function clearBatchMeta(kbId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(META_STORE, 'readwrite')
  tx.objectStore(META_STORE).delete(kbId)
  await txDone(tx)
}

/** 清除该 kbId 的所有数据（文件 + 元数据） */
export async function clearAllForKb(kbId: string): Promise<void> {
  await Promise.all([clearStagedFilesForKb(kbId), clearBatchMeta(kbId)])
}
