/* 会话存储层 — JSON 文件实现 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { Conversation, Message } from './types'

const DATA_DIR = path.join(os.homedir(), '.manta-data', 'conversations')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function convFilePath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`)
}

function readConv(id: string): Conversation | null {
  const fp = convFilePath(id)
  if (!fs.existsSync(fp)) return null
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Conversation } catch { return null }
}

function writeConv(conv: Conversation): void {
  ensureDir()
  const fp = convFilePath(conv.id)
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 2), 'utf-8')
  fs.renameSync(tmp, fp)
}

/** 创建新会话 */
export function createConversation(agentName: string, title?: string): Conversation {
  ensureDir()
  const now = new Date().toISOString()
  const conv: Conversation = {
    id: uuidv4(),
    title: title ?? '新对话',
    agentName,
    messages: [],
    context: {},
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
    return fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')) as Conversation }
        catch { return null }
      })
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
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
): { conv: Conversation; message: Message } | null {
  const conv = readConv(convId)
  if (!conv) return null

  const msg: Message = {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
  }
  conv.messages.push(msg)
  conv.updatedAt = new Date().toISOString()

  if (role === 'user' && conv.title === '新对话') {
    conv.title = content.slice(0, 30) + (content.length > 30 ? '…' : '')
  }

  writeConv(conv)
  return { conv, message: msg }
}

/** 删除会话 */
export function deleteConversation(id: string): boolean {
  const fp = convFilePath(id)
  if (!fs.existsSync(fp)) return false
  try { fs.unlinkSync(fp); return true } catch { return false }
}
