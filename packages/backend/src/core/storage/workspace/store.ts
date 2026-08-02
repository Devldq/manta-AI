/* Workspace state persists under Manta storage work/workspaces. */

import * as fs from 'fs'
import * as path from 'path'
import { resolveLocalCachePath, resolveStoragePath, safeStorageSegment } from '../../../storage/path-routing'
import { v4 as uuidv4 } from 'uuid'
import { type WorkspaceConfig, type CreateWorkspaceInput, type UpdateWorkspaceInput, type Conversation, type ConversationMessage, type ConversationSummary, type ToolCallRecord, type StepUsageRecord } from '@core/types'
import type { AgentRunSnapshot } from '@manta/contracts'
import { ensureDir, atomicWrite, shortId, removeDir } from '../shared/fs-utils'

function workspaceDataDir(): string {
  return resolveStoragePath('work', 'workspaces')
}

function workspaceDir(id: string): string {
  return path.join(workspaceDataDir(), safeStorageSegment(id))
}

function workspaceFilePath(id: string): string {
  return path.join(workspaceDir(id), 'workspace.json')
}

/** 工作空间会话目录 */
function workspaceConversationsDir(workspaceId: string): string {
  return path.join(workspaceDir(workspaceId), 'conversations')
}

function workspaceConversationIndexPath(workspaceId: string): string {
  return path.join(workspaceConversationsDir(workspaceId), '.conversation-index.json')
}

function localWorkspaceConversationIndexPath(workspaceId: string): string {
  return resolveLocalCachePath('conversation-indexes', 'workspaces', safeStorageSegment(`${workspaceId}.json`))
}

interface WorkspaceConversationSummaryIndex {
  version: 1
  conversations: ConversationSummary[]
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

function parseWorkspaceConversationIndex(raw: string): ConversationSummary[] | null {
  try {
    const value = JSON.parse(raw) as WorkspaceConversationSummaryIndex
    if (!value || value.version !== 1 || !Array.isArray(value.conversations)) return null
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

function readLocalWorkspaceConversationIndex(workspaceId: string): ConversationSummary[] | null {
  try { return parseWorkspaceConversationIndex(fs.readFileSync(localWorkspaceConversationIndexPath(workspaceId), 'utf-8')) } catch { return null }
}

async function readPortableWorkspaceConversationIndex(workspaceId: string): Promise<ConversationSummary[] | null> {
  try { return parseWorkspaceConversationIndex(await fs.promises.readFile(workspaceConversationIndexPath(workspaceId), 'utf-8')) } catch { return null }
}

function writeLocalWorkspaceConversationIndex(workspaceId: string, conversations: ConversationSummary[]): void {
  const fp = localWorkspaceConversationIndexPath(workspaceId)
  ensureDir(path.dirname(fp))
  atomicWrite(fp, JSON.stringify({ version: 1, conversations } satisfies WorkspaceConversationSummaryIndex))
}

function writeWorkspaceConversationIndex(workspaceId: string, conversations: ConversationSummary[]): void {
  writeLocalWorkspaceConversationIndex(workspaceId, conversations)
  ensureDir(workspaceConversationsDir(workspaceId))
  atomicWrite(
    workspaceConversationIndexPath(workspaceId),
    JSON.stringify({ version: 1, conversations } satisfies WorkspaceConversationSummaryIndex),
  )
}

function updateWorkspaceConversationIndex(workspaceId: string, conv: Conversation): void {
  const summaries = readLocalWorkspaceConversationIndex(workspaceId) ?? []
  writeWorkspaceConversationIndex(workspaceId, [
    ...summaries.filter((item) => item.id !== conv.id),
    toConversationSummary(conv),
  ])
}

function removeFromWorkspaceConversationIndex(workspaceId: string, conversationId: string): void {
  const summaries = readLocalWorkspaceConversationIndex(workspaceId)
  if (!summaries) return
  writeWorkspaceConversationIndex(
    workspaceId,
    summaries.filter((item) => item.id !== conversationId),
  )
}

/** 工作空间会话文件夹路径 */
function workspaceConvDir(workspaceId: string, conversationId: string): string {
  return path.join(workspaceConversationsDir(workspaceId), safeStorageSegment(conversationId))
}

/** 工作空间会话 JSON 文件路径 */
function workspaceConvSessionFilePath(workspaceId: string, conversationId: string): string {
  return path.join(workspaceConvDir(workspaceId, conversationId), 'session.json')
}

// ─── 公开 API ───────────────────────────────────────────────

/** 获取所有工作空间列表 */
export function listWorkspaces(): WorkspaceConfig[] {
  ensureDir(workspaceDataDir())
  const workspaces: WorkspaceConfig[] = []
  try {
    const entries = fs.readdirSync(workspaceDataDir(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const configPath = workspaceFilePath(entry.name)
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as WorkspaceConfig
          workspaces.push(config)
        } catch { /* skip corrupt files */ }
      }
    }
  } catch { /* directory might not exist yet */ }
  // 按更新时间降序排列
  return workspaces.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** 获取单个工作空间 */
export function getWorkspace(id: string): WorkspaceConfig | null {
  const filePath = workspaceFilePath(id)
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WorkspaceConfig
  } catch {
    return null
  }
}

/** 创建工作空间 */
export function createWorkspace(input: CreateWorkspaceInput): WorkspaceConfig {
  // 去重：若 folderPath 相同则直接返回已有工作空间
  if (input.folderPath) {
    const existing = listWorkspaces()
    const duplicate = existing.find((ws) => ws.folderPath === input.folderPath)
    if (duplicate) {
      // 更新名称（如果用户重命名了）
      if (duplicate.name !== input.name) {
        return updateWorkspace(duplicate.id, { name: input.name }) || duplicate
      }
      return duplicate
    }
  }

  const now = new Date().toISOString()
  const config: WorkspaceConfig = {
    id: shortId(),
    name: input.name,
    description: input.description,
    folderPath: input.folderPath,
    agentAppIds: [],
    knowledgeBaseIds: [],
    workflowIds: [],
    createdAt: now,
    updatedAt: now,
  }

  ensureDir(workspaceDir(config.id))
  atomicWrite(workspaceFilePath(config.id), JSON.stringify(config, null, 2))
  return config
}

/** 更新工作空间 */
export function updateWorkspace(id: string, patch: UpdateWorkspaceInput): WorkspaceConfig | null {
  const existing = getWorkspace(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const updated: WorkspaceConfig = {
    ...existing,
    ...patch,
    updatedAt: now,
  }

  atomicWrite(workspaceFilePath(id), JSON.stringify(updated, null, 2))
  return updated
}

/** 删除工作空间 */
export function deleteWorkspace(id: string): boolean {
  const dir = workspaceDir(id)
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(localWorkspaceConversationIndexPath(id), { force: true })
      return true
    }
    return false
  } catch {
    return false
  }
}

// ─── 工作空间会话 API ───────────────────────────────────────────────

/** 创建工作空间会话 */
export function createWorkspaceConversation(workspaceId: string, agentName: string, title?: string): Conversation | null {
  const wsDir = workspaceDir(workspaceId)
  if (!fs.existsSync(wsDir)) return null

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

  const convDir = workspaceConvDir(workspaceId, conv.id)
  ensureDir(convDir)
  atomicWrite(workspaceConvSessionFilePath(workspaceId, conv.id), JSON.stringify(conv, null, 2))
  updateWorkspaceConversationIndex(workspaceId, conv)
  return conv
}

/** 获取工作空间会话列表 */
export function listWorkspaceConversations(workspaceId: string): Conversation[] {
  const convsDir = workspaceConversationsDir(workspaceId)
  if (!fs.existsSync(convsDir)) return []

  const conversations: Conversation[] = []
  try {
    const entries = fs.readdirSync(convsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionPath = workspaceConvSessionFilePath(workspaceId, entry.name)
      if (fs.existsSync(sessionPath)) {
        try {
          const conv = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Conversation
          conversations.push(conv)
        } catch { /* skip corrupt files */ }
      }
    }
  } catch { /* directory might not exist yet */ }

  return conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

async function rebuildWorkspaceConversationSummaries(workspaceId: string): Promise<ConversationSummary[]> {
  try {
    const entries = await fs.promises.readdir(workspaceConversationsDir(workspaceId), { withFileTypes: true })
    const conversations = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try { return JSON.parse(await fs.promises.readFile(workspaceConvSessionFilePath(workspaceId, entry.name), 'utf-8')) as Conversation } catch { return null }
    }))
    return conversations.filter((item): item is Conversation => !!item).map(toConversationSummary)
  } catch { return [] }
}

/** 获取工作空间会话摘要。本地镜像命中时完全不接触云端；首次回填使用异步 I/O。 */
export async function listWorkspaceConversationSummaries(workspaceId: string): Promise<ConversationSummary[]> {
  const local = readLocalWorkspaceConversationIndex(workspaceId)
  if (local) return [...local].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const portable = await readPortableWorkspaceConversationIndex(workspaceId)
  const summaries = portable ?? await rebuildWorkspaceConversationSummaries(workspaceId)
  writeLocalWorkspaceConversationIndex(workspaceId, summaries)
  if (!portable) writeWorkspaceConversationIndex(workspaceId, summaries)
  return [...summaries].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

/** 获取单个工作空间会话 */
export function getWorkspaceConversation(workspaceId: string, conversationId: string): Conversation | null {
  const sessionPath = workspaceConvSessionFilePath(workspaceId, conversationId)
  try {
    if (!fs.existsSync(sessionPath)) return null
    return JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Conversation
  } catch {
    return null
  }
}

/** 更新工作空间会话 */
export function updateWorkspaceConversation(workspaceId: string, conversationId: string, conv: Conversation): void {
  const sessionPath = workspaceConvSessionFilePath(workspaceId, conversationId)
  atomicWrite(sessionPath, JSON.stringify(conv, null, 2))
  updateWorkspaceConversationIndex(workspaceId, conv)
}

/** 合并更新工作空间会话上下文。 */
export function updateWorkspaceConversationContext(
  workspaceId: string,
  conversationId: string,
  patch: Record<string, unknown>,
): Conversation | null {
  const conv = getWorkspaceConversation(workspaceId, conversationId)
  if (!conv) return null
  conv.context = { ...conv.context, ...patch }
  conv.updatedAt = new Date().toISOString()
  updateWorkspaceConversation(workspaceId, conversationId, conv)
  return conv
}

/** 更新工作空间会话标题 */
export function updateWorkspaceConversationTitle(workspaceId: string, conversationId: string, title: string): Conversation | null {
  const conv = getWorkspaceConversation(workspaceId, conversationId)
  if (!conv) return null
  conv.title = title
  conv.updatedAt = new Date().toISOString()
  updateWorkspaceConversation(workspaceId, conversationId, conv)
  return conv
}

/** 追加消息到工作空间会话 */
export function appendWorkspaceMessage(
  workspaceId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolCalls?: ToolCallRecord[],
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number },
  stepUsages?: StepUsageRecord[],
  agentAppId?: string,
  messageId?: string,
  agentRun?: AgentRunSnapshot,
): { conv: Conversation; message: ConversationMessage } | null {
  const conv = getWorkspaceConversation(workspaceId, conversationId)
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

  updateWorkspaceConversation(workspaceId, conversationId, conv)
  return { conv, message: msg }
}

/** 删除工作空间会话 */
export function deleteWorkspaceConversation(workspaceId: string, conversationId: string): boolean {
  const convDir = workspaceConvDir(workspaceId, conversationId)
  try {
    if (fs.existsSync(convDir)) {
      fs.rmSync(convDir, { recursive: true, force: true })
      removeFromWorkspaceConversationIndex(workspaceId, conversationId)
      return true
    }
    return false
  } catch {
    return false
  }
}
