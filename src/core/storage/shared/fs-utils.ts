/* 共享存储工具函数 — 消除各存储层中的重复代码 */

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

/** 生成 UUID v4 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
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

/** 生成文件名 slug：中文/英文/数字保留，其他字符替换为连字符 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-')
}
