/* AI start: CodeFlicker Skills 元数据定义 */

// AI: Skill 技能模块接口定义
export interface Skill {
  id: string
  name: string
  description: string
  triggers: string[] // 触发关键词
  source: 'internal' | 'user'
  userInvocable: boolean
  category: 'productivity' | 'development' | 'integration' | 'management'
}

// AI: 所有可用的 Skills 列表
export const SKILLS: Skill[] = [
  {
    id: 'help',
    name: 'Help',
    description: 'CodeFlicker 帮助文档，提供产品功能、使用方法和问题解答',
    triggers: ['CodeFlicker', 'CF', 'kwaipilot', '帮助', 'Help', 'Help Hub'],
    source: 'internal',
    userInvocable: true,
    category: 'productivity',
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'CodeFlicker 配置管理，支持查看、搜索、修改设置，以及从 URL 导入会话',
    triggers: ['view CodeFlicker settings', 'get CodeFlicker configuration', 'modify CodeFlicker config', '查看配置', '修改配置', '导入会话'],
    source: 'internal',
    userInvocable: true,
    category: 'management',
  },
  {
    id: 'scheduled-tasks',
    name: 'Scheduled Tasks',
    description: '定时任务管理，创建、编辑、管理定时执行的 prompt 任务',
    triggers: ['create a scheduled task', 'manage scheduled tasks', '创建定时任务', '管理定时任务', '设置自动执行'],
    source: 'internal',
    userInvocable: true,
    category: 'productivity',
  },
  {
    id: 'hooks-manager',
    name: 'Hooks Manager',
    description: 'Hooks 管理器，配置 PreToolUse、PostToolUse、SessionStart 等 hook 事件',
    triggers: ['add a hook', 'create a hook', 'view hooks', '管理 hooks', '添加 hook', '创建 hook'],
    source: 'internal',
    userInvocable: true,
    category: 'development',
  },
  {
    id: 'docs-shuttle',
    name: 'Docs Shuttle',
    description: '快手内网 Docs 文档/表格与本地双向同步工具，支持 MD/Excel/CSV 文件导入导出',
    triggers: ['上传文档到 Docs', '发布到 Docs', '从 Docs 拉取', '同步文档', '拉取表格'],
    source: 'internal',
    userInvocable: true,
    category: 'integration',
  },
  {
    id: 'subagent-manager',
    name: 'Subagent Manager',
    description: 'Subagent 生命周期管理，创建、更新、删除、克隆 subagent',
    triggers: ['create a subagent', 'update a subagent', 'delete a subagent', '管理 subagents', '创建子 Agent'],
    source: 'internal',
    userInvocable: true,
    category: 'management',
  },
  {
    id: 'find-skills',
    name: 'Find Skills',
    description: '发现和安装 agent skills，扩展 AI 助手的能力',
    triggers: ['how do I do', 'find a skill', 'is there a skill that can', '发现技能', '安装技能'],
    source: 'internal',
    userInvocable: true,
    category: 'productivity',
  },
  {
    id: 'cf-web-artifacts',
    name: 'CF Web Artifacts',
    description: '快手内部全栈开发工具链指南，包括 cf-create-web、appwrite-cf、frontend-cloud',
    triggers: ['cf-web-artifacts', 'appwrite-cf', 'frontend-cloud', '@codeflicker/appwrite'],
    source: 'internal',
    userInvocable: true,
    category: 'development',
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: '代码审查助手，生成结构化的 Review Report，支持灵活定义审查范围',
    triggers: ['Review 代码', 'Code Review', '审查代码', '检查代码变更', '帮我看看这些改动'],
    source: 'internal',
    userInvocable: true,
    category: 'development',
  },
  {
    id: 'create-subagent',
    name: 'Create Subagent',
    description: '创建自定义 subagent，为专门的 AI 任务配置定制的 prompt 和行为',
    triggers: ['create a new subagent', 'create custom subagent', '创建自定义 subagent'],
    source: 'internal',
    userInvocable: true,
    category: 'development',
  },
  {
    id: 'skill-manager',
    name: 'Skill Manager',
    description: 'Skill 生命周期管理，创建、更新、删除、发布、分享 skills',
    triggers: ['create a skill', 'update a skill', 'delete a skill', 'manage skills', '发布 skill', '分享技能'],
    source: 'internal',
    userInvocable: true,
    category: 'management',
  },
]

// AI: 按分类获取 Skills
export function getSkillsByCategory(category: Skill['category']): Skill[] {
  return SKILLS.filter((s) => s.category === category)
}

// AI: 搜索 Skills
export function searchSkills(query: string): Skill[] {
  const lowerQuery = query.toLowerCase()
  return SKILLS.filter(
    (s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.triggers.some((t) => t.toLowerCase().includes(lowerQuery))
  )
}

// AI: 获取所有分类
export const SKILL_CATEGORIES: { key: Skill['category']; label: string; icon: string }[] = [
  { key: 'productivity', label: '效率工具', icon: '⚡' },
  { key: 'development', label: '开发工具', icon: '🔧' },
  { key: 'integration', label: '集成工具', icon: '🔗' },
  { key: 'management', label: '管理工具', icon: '📋' },
]

/* AI end: Skills 元数据定义结束 */
