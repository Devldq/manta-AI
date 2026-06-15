/* 会话存储层 — 文件夹实现（每个会话一个文件夹，内含 session.json + log.ndjson 等） */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { Conversation, ConversationMessage, ToolCallRecord, StepUsageRecord } from '@/core/types'

const DATA_DIR = path.join(os.homedir(), '.manta-data', 'conversations')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

/** 会话文件夹路径 */
function convDirPath(id: string): string {
  return path.join(DATA_DIR, id)
}

/** 会话 JSON 文件路径 */
function convSessionFilePath(id: string): string {
  return path.join(convDirPath(id), 'session.json')
}

/** 会话专属日志文件路径 */
export function getSessionLogPath(conversationId: string): string {
  return path.join(convDirPath(conversationId), 'log.ndjson')
}

/** 确保会话文件夹存在 */
function ensureConvDir(id: string): void {
  const dir = convDirPath(id)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readConv(id: string): Conversation | null {
  // 先尝试新格式（文件夹中的 session.json）
  const newFp = convSessionFilePath(id)
  if (fs.existsSync(newFp)) {
    try { return JSON.parse(fs.readFileSync(newFp, 'utf-8')) as Conversation } catch { return null }
  }
  // 兼容旧格式（直接的 .json 文件）
  const oldFp = path.join(DATA_DIR, `${id}.json`)
  if (fs.existsSync(oldFp)) {
    try { return JSON.parse(fs.readFileSync(oldFp, 'utf-8')) as Conversation } catch { return null }
  }
  return null
}

function writeConv(conv: Conversation): void {
  ensureDir()
  ensureConvDir(conv.id)
  const fp = convSessionFilePath(conv.id)
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 2), 'utf-8')
  fs.renameSync(tmp, fp)
}

/** 迁移旧的 .json 文件到文件夹格式 */
function migrateOldFormat(id: string): boolean {
  const oldFp = path.join(DATA_DIR, `${id}.json`)
  if (!fs.existsSync(oldFp)) return false
  try {
    const conv = JSON.parse(fs.readFileSync(oldFp, 'utf-8')) as Conversation
    writeConv(conv)
    fs.unlinkSync(oldFp)
    return true
  } catch {
    return false
  }
}

/** 创建新会话 */
export function createConversation(agentName: string, title?: string, workspaceId?: string): Conversation {
  ensureDir()
  const now = new Date().toISOString()
  const conv: Conversation = {
    id: uuidv4(),
    title: title ?? '新对话',
    agentName,
    messages: [],
    context: {},
    workspaceId,
    createdAt: now,
    updatedAt: now,
  }
  writeConv(conv)
  return conv
}

/** 获取会话列表（按 updatedAt 倒序） */
export function listConversations(): Conversation[] {
  ensureDir()
  try {
    const convs: Conversation[] = []
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // 新格式：文件夹中的 session.json
        const sfp = convSessionFilePath(entry.name)
        if (fs.existsSync(sfp)) {
          try { convs.push(JSON.parse(fs.readFileSync(sfp, 'utf-8')) as Conversation) } catch { /* skip */ }
        }
      } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.endsWith('.tmp')) {
        // 旧格式兼容：直接的 .json 文件
        try {
          const conv = JSON.parse(fs.readFileSync(path.join(DATA_DIR, entry.name), 'utf-8')) as Conversation
          if (conv.id) {
            // 自动迁移到新格式
            migrateOldFormat(conv.id)
            convs.push(conv)
          }
        } catch { /* skip */ }
      }
    }

    return convs.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
  } catch { return [] }
}

/** 获取单个会话 */
export function getConversation(id: string): Conversation | null {
  return readConv(id)
}

/** 更新会话 agentName */
export function updateConversationAgent(id: string, agentName: string): Conversation | null {
  const conv = readConv(id)
  if (!conv) return null
  conv.agentName = agentName
  conv.updatedAt = new Date().toISOString()
  writeConv(conv)
  return conv
}

/** 追加消息到会话，首条用户消息自动设为标题 */
export function appendMessage(
  convId: string,
  role: 'user' | 'assistant',
  content: string,
  toolCalls?: ToolCallRecord[],
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number },
  stepUsages?: StepUsageRecord[],
  agentAppId?: string,
): { conv: Conversation; message: ConversationMessage } | null {
  const conv = readConv(convId)
  if (!conv) return null

  const msg: ConversationMessage = {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
    ...(stepUsages && stepUsages.length > 0 ? { stepUsages } : {}),
    ...(agentAppId ? { agentAppId } : {}),
  }
  conv.messages.push(msg)
  conv.updatedAt = new Date().toISOString()

  if (role === 'user' && conv.title === '新对话') {
    conv.title = content.slice(0, 30) + (content.length > 30 ? '…' : '')
  }

  writeConv(conv)
  return { conv, message: msg }
}

/** 递归删除文件夹 */
function removeDir(dir: string): void {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removeDir(full)
    } else {
      fs.unlinkSync(full)
    }
  }
  fs.rmdirSync(dir)
}

/** 删除会话 */
export function deleteConversation(id: string): boolean {
  // 新格式：删除整个文件夹
  const dir = convDirPath(id)
  if (fs.existsSync(dir)) {
    try { removeDir(dir); return true } catch { return false }
  }
  // 旧格式兼容：删除 .json 文件
  const oldFp = path.join(DATA_DIR, `${id}.json`)
  if (fs.existsSync(oldFp)) {
    try { fs.unlinkSync(oldFp); return true } catch { return false }
  }
  return false
}
