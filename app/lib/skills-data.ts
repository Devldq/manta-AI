/* AI start: Skills 元数据定义 — 从本地动态加载，不再硬编码 */

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

// AI: 默认空数组，skills 从本地 ~/.codex/skills/ 动态加载
export const SKILLS: Skill[] = []

// AI: 从 API 加载 skills（供前端页面调用）
export async function fetchSkills(): Promise<Skill[]> {
  try {
    const res = await fetch('/api/skills')
    if (!res.ok) return []
    const data = await res.json()
    return data.skills ?? []
  } catch {
    return []
  }
}

// AI: 按分类获取 Skills
export function getSkillsByCategory(skills: Skill[], category: Skill['category']): Skill[] {
  return skills.filter((s) => s.category === category)
}

// AI: 搜索 Skills
export function searchSkills(skills: Skill[], query: string): Skill[] {
  const lowerQuery = query.toLowerCase()
  return skills.filter(
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