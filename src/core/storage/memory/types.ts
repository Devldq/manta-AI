/* 记忆系统类型定义 */

/** 记忆条目类型 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

/** 单条记忆条目（完整模型，含文件路径） */
export interface MemoryEntry {
  name: string
  description: string
  type: MemoryType
  content: string
  filePath: string
}

/** 索引条目（MEMORY.md 中每行的格式：name | filename | description） */
export interface IndexEntry {
  name: string
  filename: string
  description: string
}
