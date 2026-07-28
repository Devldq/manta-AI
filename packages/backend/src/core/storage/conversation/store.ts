/* 会话存储层 — 文件夹实现（每个会话一个文件夹，内含 session.json + log.ndjson 等） */
import * as fs from 'fs'
import * as path from 'path'
import { resolveLocalCachePath, resolveStoragePath, safeStorageSegment } from '../../../storage/path-routing'
import { v4 as uuidv4 } from 'uuid'
import type { Conversation, ConversationMessage, ConversationSummary, ToolCallRecord, StepUsageRecord } from '@core/types'
import type { AgentRunSnapshot } from '@manta/contracts'

function dataDir(): string { return resolveStoragePath('work', 'conversations') }
const SUMMARY_INDEX_FILE = '.conversation-index.json'

interface ConversationSummaryIndex {
  version: 1
  conversations: ConversationSummary[]
}

function ensureDir(): void {
  const dir = dataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 会话文件夹路径 */
function convDirPath(id: string): string {
  return path.join(dataDir(), safeStorageSegment(id))
}

/** 会话 JSON 文件路径 */
function convSessionFilePath(id: string): string {
  return path.join(convDirPath(id), 'session.json')
}

function summaryIndexFilePath(): string {
  return path.join(dataDir(), SUMMARY_INDEX_FILE)
}

function localSummaryIndexFilePath(): string {
  return resolveLocalCachePath('conversation-indexes', 'global.json')
}

function toConversationSummary(conv: Conversation): ConversationSummary {
  return {
    id: conv.id,
    title: conv.title,
    agentName: conv.agentName,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    ...(conv.workspaceId ? { workspaceId: conv.workspaceId } : {}),
    messageCount: conv.messages.length,
  }
}

function parseSummaryIndex(raw: string): ConversationSummary[] | null {
  try {
    const value = JSON.parse(raw) as ConversationSummaryIndex
    if (value.version !== 1 || !Array.isArray(value.conversations)) return null
    if (value.conversations.some((item) => (
      typeof item?.id !== 'string'
      || typeof item.title !== 'string'
      || typeof item.agentName !== 'string'
      || typeof item.createdAt !== 'string'
      || typeof item.updatedAt !== 'string'
    ))) return null
    return value.conversations
  } catch {
    return null
  }
}

function readLocalSummaryIndex(): ConversationSummary[] | null {
  try { return parseSummaryIndex(fs.readFileSync(localSummaryIndexFilePath(), 'utf-8')) } catch { return null }
}

async function readPortableSummaryIndex(): Promise<ConversationSummary[] | null> {
  try { return parseSummaryIndex(await fs.promises.readFile(summaryIndexFilePath(), 'utf-8')) } catch { return null }
}

function writeLocalSummaryIndex(conversations: ConversationSummary[]): void {
  const fp = localSummaryIndexFilePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, conversations } satisfies ConversationSummaryIndex), 'utf-8')
  fs.renameSync(tmp, fp)
}

function writeSummaryIndex(conversations: ConversationSummary[]): void {
  writeLocalSummaryIndex(conversations)
  ensureDir()
  const fp = summaryIndexFilePath()
  const tmp = `${fp}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, conversations } satisfies ConversationSummaryIndex), 'utf-8')
  fs.renameSync(tmp, fp)
}

function updateSummaryIndex(conv: Conversation): void {
  const summaries = readLocalSummaryIndex() ?? []
  const next = summaries.filter((item) => item.id !== conv.id)
  if (!conv.workspaceId) next.push(toConversationSummary(conv))
  writeSummaryIndex(next)
}

function removeFromSummaryIndex(id: string): void {
  const summaries = readLocalSummaryIndex()
  if (!summaries) return
  writeSummaryIndex(summaries.filter((item) => item.id !== id))
}

/** 会话专属日志文件路径 */
export function getSessionLogPath(conversationId: string): string {
  return resolveStoragePath('diagnostics', 'conversations', conversationId, 'log.ndjson')
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
  const oldFp = path.join(dataDir(), safeStorageSegment(`${id}.json`))
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
  updateSummaryIndex(conv)
}

/** 迁移旧的 .json 文件到文件夹格式 */
function migrateOldFormat(id: string): boolean {
  const oldFp = path.join(dataDir(), safeStorageSegment(`${id}.json`))
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
    const entries = fs.readdirSync(dataDir(), { withFileTypes: true })

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
          const conv = JSON.parse(fs.readFileSync(path.join(dataDir(), entry.name), 'utf-8')) as Conversation
          if (conv.id) {
            // 自动迁移到新格式
            migrateOldFormat(conv.id)
            convs.push(conv)
          }
        } catch { /* skip */ }
      }
    }

    // 排除带 workspaceId 的会话（这些应该在工作空间存储中）
    const globalConvs = convs.filter(c => !c.workspaceId)
    return globalConvs.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
  } catch { return [] }
}

async function rebuildConversationSummaries(): Promise<ConversationSummary[]> {
  try {
    const entries = await fs.promises.readdir(dataDir(), { withFileTypes: true })
    const conversations = await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        try { return JSON.parse(await fs.promises.readFile(convSessionFilePath(entry.name), 'utf-8')) as Conversation } catch { return null }
      }
      if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== SUMMARY_INDEX_FILE && !entry.name.endsWith('.tmp')) {
        try { return JSON.parse(await fs.promises.readFile(path.join(dataDir(), entry.name), 'utf-8')) as Conversation } catch { return null }
      }
      return null
    }))
    return conversations.filter((item): item is Conversation => !!item && !item.workspaceId).map(toConversationSummary)
  } catch { return [] }
}

/** 获取会话摘要列表。本地镜像命中时完全不接触云端；首次回填使用异步 I/O。 */
export async function listConversationSummaries(): Promise<ConversationSummary[]> {
  const local = readLocalSummaryIndex()
  if (local) return [...local].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))

  const portable = await readPortableSummaryIndex()
  const summaries = portable ?? await rebuildConversationSummaries()
  writeLocalSummaryIndex(summaries)
  if (!portable) writeSummaryIndex(summaries)
  return [...summaries].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
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

/** 合并更新会话上下文，用于持久化执行前门禁等控制面状态。 */
export function updateConversationContext(
  id: string,
  patch: Record<string, unknown>,
): Conversation | null {
  const conv = readConv(id)
  if (!conv) return null
  conv.context = { ...conv.context, ...patch }
  conv.updatedAt = new Date().toISOString()
  writeConv(conv)
  return conv
}

/** 更新会话标题 */
export function updateConversationTitle(id: string, title: string): Conversation | null {
  const conv = readConv(id)
  if (!conv) return null
  conv.title = title
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
  messageId?: string,
  agentRun?: AgentRunSnapshot,
): { conv: Conversation; message: ConversationMessage } | null {
  const conv = readConv(convId)
  if (!conv) return null

  if (messageId) {
    const existing = conv.messages.find((message) => message.id === messageId)
    if (existing) return { conv, message: existing }
  }

  const msg: ConversationMessage = {
    id: messageId ?? uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    ...(usage ? { usage } : {}),
    ...(stepUsages && stepUsages.length > 0 ? { stepUsages } : {}),
    ...(agentRun ? { agentRun } : {}),
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
    try {
      removeDir(dir)
      removeFromSummaryIndex(id)
      return true
    } catch { return false }
  }
  // 旧格式兼容：删除 .json 文件
  const oldFp = path.join(dataDir(), safeStorageSegment(`${id}.json`))
  if (fs.existsSync(oldFp)) {
    try {
      fs.unlinkSync(oldFp)
      removeFromSummaryIndex(id)
      return true
    } catch { return false }
  }
  return false
}
