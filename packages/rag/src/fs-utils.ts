/* 文件系统工具 — RAG 包自用 */

import * as fs from 'fs'
import * as path from 'path'

/** 确保目录存在，不存在则递归创建 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** 原子写入：先写 .tmp 再 rename，避免写入中断导致文件损坏 */
export function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, data, 'utf-8')
  fs.renameSync(tmp, filePath)
}

/** 生成简短唯一 ID（8位随机字符串） */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** 安全读取 JSON 文件，失败返回 null */
export function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

/** 安全写入 JSON 文件（原子写入） */
export function writeJsonFile<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath))
  atomicWrite(filePath, JSON.stringify(data, null, 2))
}

/** 删除目录（递归） */
export function removeDir(dir: string): boolean {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      return true
    }
    return false
  } catch {
    return false
  }
}
