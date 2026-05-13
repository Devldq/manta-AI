/*  start: Skills Registry API — GET /api/skills（从本地 ~/.codex/skills/ 读取）*/
// AI: 从本地 Codex skills 目录扫描已安装的 skill 元数据
import { NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: skill 目录根路径
const SKILLS_ROOT = path.join(os.homedir(), '.codex', 'skills')

// AI: skill 元数据结构（与前端 Skill 接口对齐）
interface SkillMeta {
  id: string
  name: string
  description: string
  triggers: string[]
  source: 'internal' | 'user'
  userInvocable: boolean
  category: 'productivity' | 'development' | 'integration' | 'management'
}

// AI: 从 SKILL.md 的 YAML frontmatter 解析 name / description
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const yaml = match[1]
  const nameMatch = yaml.match(/^name:\s*(.+)$/m)
  const descMatch = yaml.match(/^description:\s*(.+)$/m)
  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  }
}

// AI: 根据 skill id 推断分类
function inferCategory(id: string): SkillMeta['category'] {
  if (id.includes('review') || id.includes('dev') || id.includes('code') || id.includes('create') || id.includes('web') || id.includes('canvas') || id.includes('pet')) return 'development'
  if (id.includes('docs') || id.includes('sync') || id.includes('shuttle')) return 'integration'
  if (id.includes('settings') || id.includes('hook') || id.includes('agent') || id.includes('skill') || id.includes('scheduled') || id.includes('task')) return 'management'
  return 'productivity'
}

// AI: 从 skill id 推断触发关键词
function inferTriggers(id: string, name: string): string[] {
  const triggers: string[] = [name, id]
  // 常见触发词映射
  const triggerMap: Record<string, string[]> = {
    help: ['帮助', 'Help', 'CodeFlicker'],
    settings: ['查看配置', '修改配置', '导入会话', 'configuration'],
    scheduled: ['定时任务', '自动执行', 'cron'],
    hooks: ['hooks', '添加 hook', '创建 hook'],
    docs: ['上传文档', '同步文档', '拉取表格'],
    agent: ['subagent', '子 Agent', '管理'],
    find: ['发现技能', '安装技能', 'find a skill'],
    review: ['Code Review', '审查代码', '检查代码变更'],
    create: ['创建', '新建', 'create'],
    skill: ['发布 skill', '分享技能', 'manage skills'],
  }
  for (const [key, words] of Object.entries(triggerMap)) {
    if (id.includes(key)) triggers.push(...words)
  }
  return triggers
}

// AI: 扫描 skills 目录，读取每个 skill 的 SKILL.md
function loadSkills(): SkillMeta[] {
  if (!fs.existsSync(SKILLS_ROOT)) return []

  const skills: SkillMeta[] = []
  const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue

    const skillDir = path.join(SKILLS_ROOT, entry.name)
    const skillMdPath = path.join(skillDir, 'SKILL.md')

    if (!fs.existsSync(skillMdPath)) continue

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const meta = parseFrontmatter(content)

      // AI: .system 目录下的 skill 标记为 internal，其余为 user
      const isSystem = skillDir.includes('/.system/')
      const name = meta.name || entry.name
      const description = meta.description || `Skill: ${name}`

      skills.push({
        id: entry.name,
        name,
        description,
        triggers: inferTriggers(entry.name, name),
        source: isSystem ? 'internal' : 'user',
        userInvocable: true,
        category: inferCategory(entry.name),
      })
    } catch {
      continue
    }
  }

  return skills
}

export async function GET() {
  try {
    const skills = loadSkills()
    return NextResponse.json({ skills })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: Skills Registry API 结束 */