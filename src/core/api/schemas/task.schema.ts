import { z } from 'zod'

export const CreateTaskSchema = z.object({
  agentName: z
    .string()
    .min(1, 'agentName 不能为空')
    .trim(),
  title: z.string().trim().optional(),
  type: z.enum(['global', 'workspace']).default('global'),
  workspaceId: z.string().optional(),
  appId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const UpdateTaskSchema = z.object({
  title: z.string().trim().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  archived: z.boolean().optional(),
})

export const SendMessageSchema = z.object({
  content: z
    .string()
    .min(1, '消息内容不能为空')
    .max(100000, '消息内容过长'),
  role: z.enum(['user', 'assistant', 'system']).default('user'),
  agentAppId: z.string().optional(),
  attachments: z.array(z.object({
    type: z.enum(['file', 'image', 'audio', 'video']),
    url: z.string().url(),
    name: z.string(),
    size: z.number().int().positive(),
    mimeType: z.string(),
  })).optional(),
})

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>
