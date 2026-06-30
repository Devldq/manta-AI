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
  folderPath: z.string().optional(),
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

// ─── Skill Schemas ───────────────────────────────────────────────

export const CreateSkillSchema = z.object({
  name: z
    .string()
    .min(1, 'Skill 名称不能为空')
    .max(64, 'Skill 名称不能超过 64 个字符')
    .regex(/^[a-z][a-z0-9-]*$/, 'Skill 名称必须以小写字母开头，仅包含小写字母、数字和连字符'),
  description: z
    .string()
    .min(1, 'Skill 描述不能为空')
    .max(1024, 'Skill 描述不能超过 1024 个字符'),
  version: z.string().optional(),
  type: z.enum(['writing', 'tool', 'workflow']),
  content: z.string().min(1, 'Skill 指令内容不能为空'),
  license: z.string().optional(),
  userInvocable: z.boolean().optional(),
  argumentHint: z.string().optional(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
        description: z.string(),
        required: z.boolean().optional(),
        default: z.unknown().optional(),
        enum: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  tools: z.array(z.string()).optional(),
})

export const UpdateSkillSchema = CreateSkillSchema.partial().extend({
  enabled: z.boolean().optional(),
})

export const ToggleSkillSchema = z.object({
  enabled: z.boolean(),
})

export const BindSkillAgentsSchema = z.object({
  agentNames: z.array(z.string()).min(1, '至少需要绑定一个 Agent'),
})

export type CreateSkillSchemaInput = z.infer<typeof CreateSkillSchema>
export type UpdateSkillSchemaInput = z.infer<typeof UpdateSkillSchema>
export type ToggleSkillSchemaInput = z.infer<typeof ToggleSkillSchema>
export type BindSkillAgentsSchemaInput = z.infer<typeof BindSkillAgentsSchema>

/** 动态创建并导入 Skill（写 SKILL.md 文件 + 入库一步到位） */
export const CreateAndImportSkillSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(64),
  description: z.string().min(1, '描述不能为空').max(1024),
  type: z.enum(['writing', 'tool', 'workflow']),
  content: z.string().min(1, '指令内容不能为空'),
  version: z.string().optional(),
  license: z.string().optional(),
  argumentHint: z.string().optional(),
  tools: z.array(z.string()).optional(),
})

export type CreateAndImportSkillSchemaInput = z.infer<typeof CreateAndImportSkillSchema>

// ─── Plugin Schemas ──────────────────────────────────────────────

export const PluginCapabilitySchema = z.object({
  type: z.enum(['agent', 'skill', 'mcp-server', 'command', 'hook', 'tool', 'ui']),
  name: z.string().min(1),
  description: z.string().optional(),
  entry: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const PluginHookSchema = z.object({
  name: z.string().min(1),
  event: z.enum([
    'pre-install', 'post-install',
    'pre-uninstall', 'post-uninstall',
    'on-enable', 'on-disable', 'on-upgrade',
    'pre-agent-run', 'post-agent-run',
  ]),
  command: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  blocking: z.boolean().optional(),
})

export const PluginDependencySchema = z.object({
  pluginId: z.string().min(1),
  version: z.string().optional(),
  required: z.boolean().default(true),
})

export const PluginPermissionSchema = z.object({
  type: z.enum(['network', 'filesystem', 'process', 'env']),
  scope: z.string().min(1),
  action: z.enum(['read', 'write', 'execute']).optional(),
})

export const CreatePluginSchema = z.object({
  source: z.string().min(1, '安装来源不能为空'),
  isNpm: z.boolean().optional(),
  version: z.string().optional(),
})

export const UpdatePluginSchema = z.object({
  state: z.enum(['installed', 'active', 'error']).optional(),
  manifest: z.object({
    name: z.string().min(1).optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().optional(),
    requires: z.string().optional(),
    capabilities: z.array(PluginCapabilitySchema).optional(),
    hooks: z.array(PluginHookSchema).optional(),
    dependencies: z.array(PluginDependencySchema).optional(),
    permissions: z.array(PluginPermissionSchema).optional(),
  }).optional(),
})

export const PluginToggleSchema = z.object({
  enabled: z.boolean(),
})

export type CreatePluginSchemaInput = z.infer<typeof CreatePluginSchema>
export type UpdatePluginSchemaInput = z.infer<typeof UpdatePluginSchema>
export type PluginToggleSchemaInput = z.infer<typeof PluginToggleSchema>
