import { z } from 'zod'

// ─── App Schemas ───────────────────────────────────────────────

export const CreateAppSchema = z.object({
  name: z
    .string()
    .min(1, '应用名称不能为空')
    .max(30, '应用名称不能超过 30 个字符')
    .trim(),
  description: z.string().trim().optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  stopSequences: z.array(z.string()).optional(),
})

export const UpdateAppSchema = CreateAppSchema.partial()

export type CreateAppSchemaInput = z.infer<typeof CreateAppSchema>
export type UpdateAppSchemaInput = z.infer<typeof UpdateAppSchema>

// ─── Conversation Schemas ───────────────────────────────────────

export const CreateConversationSchema = z.object({
  agentName: z
    .string()
    .min(1, 'agentName 不能为空')
    .trim(),
  title: z.string().trim().optional(),
  workspaceId: z.string().optional(),
  appId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateConversationSchema = z.object({
  title: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
})

export const SendMessageSchema = z.object({
  content: z
    .string()
    .min(1, '消息内容不能为空')
    .max(100000, '消息内容过长'),
  role: z.enum(['user', 'assistant']).default('user'),
  agentAppId: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(['file', 'image', 'audio', 'video']),
    url: z.string().url(),
    name: z.string(),
    size: z.number().int().positive(),
    mimeType: z.string(),
  })).optional(),
})

export type CreateConversationSchemaInput = z.infer<typeof CreateConversationSchema>
export type UpdateConversationSchemaInput = z.infer<typeof UpdateConversationSchema>
export type SendMessageSchemaInput = z.infer<typeof SendMessageSchema>

// ─── Workspace Schemas ───────────────────────────────────────

export const CreateWorkspaceSchema = z.object({
  name: z
    .string()
    .min(1, '工作空间名称不能为空')
    .max(50, '工作空间名称不能超过 50 个字符')
    .trim(),
  description: z.string().trim().optional(),
  icon: z.string().optional(),
  isDefault: z.boolean().optional(),
  agentAppIds: z.array(z.string()).optional(),
  knowledgeBaseIds: z.array(z.string()).optional(),
  workflowIds: z.array(z.string()).optional(),
  automationIds: z.array(z.string()).optional(),
  memoryEnabled: z.boolean().optional(),
  memoryIsolation: z.enum(['global', 'workspace', 'app']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateWorkspaceSchema = CreateWorkspaceSchema.partial()

export const BindEntitySchema = z.object({
  entityIds: z.array(z.string()).min(1, '至少需要一个实体ID'),
})

export type CreateWorkspaceSchemaInput = z.infer<typeof CreateWorkspaceSchema>
export type UpdateWorkspaceSchemaInput = z.infer<typeof UpdateWorkspaceSchema>
export type BindEntitySchemaInput = z.infer<typeof BindEntitySchema>
