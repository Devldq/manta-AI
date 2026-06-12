/* core/memory — 记忆系统统一导出 */

import { MemoryStore } from './store'

// ─── 模块级单例 ───────────────────────────────────────────────────────────────

let _store: MemoryStore | null = null

/** 获取全局 MemoryStore 单例 */
export function getMemoryStore(): MemoryStore {
  if (!_store) {
    _store = new MemoryStore()
    _store.init()
  }
  return _store
}

/** 重置单例（供测试使用） */
export function resetMemoryStore(): void {
  _store = null
}

export { MemoryStore } from './store'
export type { MemoryEntry, MemoryType, IndexEntry } from './types'
