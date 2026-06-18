import { z } from 'zod'

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

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>