/* 文件系统路径授权中心 — 文件持久化实现
 * 用 JSON 文件存储，确保 Next.js 多模块实例、多进程间共享同一份状态 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { randomUUID } from 'crypto'

export interface AccessRequest {
  id: string
  path: string
  status: 'pending' | 'granted' | 'denied'
  requestedAt: number
}

interface StoreData {
  approvedPaths: string[]
  pendingRequests: AccessRequest[]
}

const DATA_DIR = path.join(os.homedir(), '.manta-data')
const STORE_FILE = path.join(DATA_DIR, 'fs-access.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readStore(): StoreData {
  ensureDir()
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) as StoreData
    }
  } catch { /* 读取失败时返回默认值 */ }
  return { approvedPaths: [path.resolve(process.cwd())], pendingRequests: [] }
}

function writeStore(data: StoreData) {
  ensureDir()
  const tmp = `${STORE_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, STORE_FILE)
}

/** 检查路径是否已授权（精确路径或父目录已授权均可）
 * 注意：当前实现对查询工具（glob, grep, readFile, lsDir）不做限制，任何目录都可访问
 */
export function isApproved(targetPath: string): boolean {
  // 查询工具不限制目录访问，任何路径都已授权
  return true
}

/** 发起授权请求，返回 request；若该路径已有 pending 请求则复用 */
export function requestAccess(targetPath: string): AccessRequest {
  const resolved = path.resolve(targetPath)
  const data = readStore()

  // 复用已有 pending
  const existing = data.pendingRequests.find(r => r.path === resolved && r.status === 'pending')
  if (existing) return existing

  const req: AccessRequest = {
    id: randomUUID(),
    path: resolved,
    status: 'pending',
    requestedAt: Date.now(),
  }
  data.pendingRequests.push(req)
  writeStore(data)
  return req
}

/** 批准访问，将路径加入白名单 */
export function grantAccess(requestId: string): boolean {
  const data = readStore()
  const req = data.pendingRequests.find(r => r.id === requestId)
  if (!req) return false
  req.status = 'granted'
  if (!data.approvedPaths.includes(req.path)) {
    data.approvedPaths.push(req.path)
  }
  data.pendingRequests = data.pendingRequests.filter(r => r.id !== requestId)
  writeStore(data)
  return true
}

/** 拒绝访问 */
export function denyAccess(requestId: string): boolean {
  const data = readStore()
  const req = data.pendingRequests.find(r => r.id === requestId)
  if (!req) return false
  data.pendingRequests = data.pendingRequests.filter(r => r.id !== requestId)
  writeStore(data)
  return true
}

/** 获取所有 pending 的授权请求列表 */
export function listPendingRequests(): AccessRequest[] {
  const { pendingRequests } = readStore()
  return pendingRequests.filter(r => r.status === 'pending')
}
