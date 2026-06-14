import { z } from 'zod'

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

export type CreateAppInput = z.infer<typeof CreateAppSchema>
export type UpdateAppInput = z.infer<typeof UpdateAppSchema>