/* 会话存储层 — JSON 文件实现，对应 ~/arm-data/conversations/ */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'
import type { Conversation, Message } from './types'

// AI: 会话数据目录
const DATA_DIR = path.join(os.homedir(), '.manta-data', 'conversations')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function convFilePath(id: string): string {
  return path.join(DATA_DIR, `${id}.json`)
}

function readConv(id: string): Conversation | null {
  const fp = convFilePath(id)
  if (!fs.existsSync(fp)) return null
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Conversation
  } catch {
    return null
  }
}

function writeConv(conv: Conversation): void {
  ensureDir()
  const fp = convFilePath(conv.id)
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(conv, null, 2), 'utf-8')
  fs.renameSync(tmp, fp)
}

// ─── 公共 API ───────────────────────────────────────────────────────────────

/** 创建新会话 */
export function createConversation(agentName: string, title?: string, mode?: 'chat' | 'task'): Conversation {
  ensureDir()
  const now = new Date().toISOString()
  const conv: Conversation = {
    id: uuidv4(),
    title: title ?? '新任务',
    agentName,
    messages: [],
    context: {},
    createdAt: now,
    updatedAt: now,
    mode: mode ?? 'task',
  }
  writeConv(conv)
  return conv
}

/** 获取会话列表（按 updatedAt 倒序），支持按 mode 筛选 */
export function listConversations(mode?: 'chat' | 'task'): Conversation[] {
  ensureDir()
  try {
    const conversations = fs
      .readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map((f) => {
        try {
          return JSON.parse(
            fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')
          ) as Conversation
        } catch {
          return null
        }
      })
      .filter((c): c is Conversation => c !== null)
    
    // AI: 按 mode 筛选
    const filtered = mode ? conversations.filter((c) => c.mode === mode) : conversations
    
    // AI: 按 updatedAt 倒序
    return filtered.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
  } catch {
    return []
  }
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

/** 追加消息到会话 */
export function appendMessage(
  convId: string,
  role: 'user' | 'assistant',
  content: string,
  taskId?: string
): { conv: Conversation; message: Message } | null {
  const conv = readConv(convId)
  if (!conv) return null

  const msg: Message = {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
    taskId,
  }
  conv.messages.push(msg)
  conv.updatedAt = new Date().toISOString()

  // AI: 首条用户消息作为会话标题（截取前30字符）
  if (role === 'user' && conv.title === '新任务') {
    conv.title = content.slice(0, 30) + (content.length > 30 ? '…' : '')
  }

  writeConv(conv)
  return { conv, message: msg }
}

/** 删除会话中的某条消息 */
export function deleteMessage(convId: string, messageId: string): boolean {
  const conv = readConv(convId)
  if (!conv) return false
  const idx = conv.messages.findIndex((m) => m.id === messageId)
  if (idx < 0) return false
  conv.messages.splice(idx, 1)
  conv.updatedAt = new Date().toISOString()
  writeConv(conv)
  return true
}

/** 按 taskId 更新对应 assistant 消息的内容（精确匹配，避免多轮对话写错位置）*/
export function updateAssistantMessageByTaskId(convId: string, taskId: string, content: string): boolean {
  const conv = readConv(convId)
  if (!conv) return false

  const msg = conv.messages.find((m) => m.role === 'assistant' && m.taskId === taskId)
  if (!msg) return false

  msg.content = content
  conv.updatedAt = new Date().toISOString()
  writeConv(conv)
  return true
}

/** 更新最后一条 assistant 消息的内容（兜底用，优先使用 updateAssistantMessageByTaskId）*/
export function updateLastAssistantMessage(convId: string, content: string): boolean {
  const conv = readConv(convId)
  if (!conv) return false

  const last = [...conv.messages].reverse().find((m) => m.role === 'assistant')
  if (!last) return false

  last.content = content
  conv.updatedAt = new Date().toISOString()
  writeConv(conv)
  return true
}
