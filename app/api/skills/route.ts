/* AI start: Skills API — 读取本机 CodeFlicker skills 目录，返回 skill 列表 */
import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface SkillInfo {
  name: string
  description: string
  version: string
  source: 'plugin' | 'personal' | 'project'
  sourcePath: string
  userInvocable: boolean
  hasVersionFile: boolean
  files: string[]
}

// AI: 解析 SKILL.md 中的 YAML frontmatter
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const yaml = match[1]
  const result: Record<string, string> = {}
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key) result[key] = val
  }
  return result
}

// AI: 读取单个 skill 目录
function readSkillDir(skillDir: string, source: SkillInfo['source']): SkillInfo | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) return null

  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const meta = parseFrontmatter(content)

  const skillName = meta['name'] || path.basename(skillDir)
  const files = fs.readdirSync(skillDir).filter(f => {
    const fp = path.join(skillDir, f)
    return fs.statSync(fp).isFile() || fs.statSync(fp).isDirectory()
  })

  const hasVersionFile = files.some(f => f.startsWith('.version-'))
  const versionFromFile = files.find(f => f.startsWith('.version-'))?.replace('.version-', '') ?? ''

  return {
    name: skillName,
    description: meta['description'] || '',
    version: meta['version'] || versionFromFile || '1.0.0',
    source,
    sourcePath: skillDir,
    userInvocable: meta['user_invocable'] !== 'false',
    hasVersionFile,
    files,
  }
}

// AI: 扫描指定目录下的所有 skills
function scanSkillsDir(baseDir: string, source: SkillInfo['source']): SkillInfo[] {
  if (!fs.existsSync(baseDir)) return []
  const skills: SkillInfo[] = []
  try {
    const entries = fs.readdirSync(baseDir)
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry)
      if (!fs.statSync(fullPath).isDirectory()) continue
      const skill = readSkillDir(fullPath, source)
      if (skill) skills.push(skill)
    }
  } catch {
    // silent
  }
  return skills
}

export async function GET() {
  const home = os.homedir()
  const cwd = process.cwd()

  // AI: 按优先级扫描三个来源（个人 > 项目 > 插件）
  const pluginSkillsDir = path.join(home, '.codeflicker', 'internal', 'skills')
  const personalSkillsDir = path.join(home, '.codeflicker', 'skills')
  const projectSkillsDir = path.join(cwd, '.codeflicker', 'skills')

  const pluginSkills = scanSkillsDir(pluginSkillsDir, 'plugin')
  const personalSkills = scanSkillsDir(personalSkillsDir, 'personal')
  const projectSkills = scanSkillsDir(projectSkillsDir, 'project')

  // AI: 合并，个人 > 项目 > 插件（同名覆盖）
  const skillMap = new Map<string, SkillInfo>()
  for (const s of pluginSkills) skillMap.set(s.name, s)
  for (const s of projectSkills) skillMap.set(s.name, s)
  for (const s of personalSkills) skillMap.set(s.name, s)

  const allSkills = Array.from(skillMap.values())

  return NextResponse.json({
    skills: allSkills,
    stats: {
      total: allSkills.length,
      plugin: pluginSkills.length,
      personal: personalSkills.length,
      project: projectSkills.length,
    },
    dirs: {
      plugin: pluginSkillsDir,
      personal: personalSkillsDir,
      project: projectSkillsDir,
    },
  })
}
/* AI end: Skills API */
