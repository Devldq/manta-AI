import { z } from 'zod'

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

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>
export type BindEntityInput = z.infer<typeof BindEntitySchema>