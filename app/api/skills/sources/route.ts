/* AI start: 远程 Skills 源管理 API — GET 获取列表 / POST 新增 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'skills-sources.yaml')

export interface RemoteSkillSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

// AI: 简单 YAML 解析（不依赖第三方库，只处理 sources 列表格式）
function parseSourcesYaml(content: string): RemoteSkillSource[] {
  const sources: RemoteSkillSource[] = []
  const lines = content.split('\n')
  let current: Partial<RemoteSkillSource> | null = null

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.startsWith('  - id:')) {
      if (current?.id) sources.push(current as RemoteSkillSource)
      current = { id: line.replace('  - id:', '').trim(), enabled: true }
    } else if (line.startsWith('    name:') && current) {
      current.name = line.replace('    name:', '').trim()
    } else if (line.startsWith('    url:') && current) {
      current.url = line.replace('    url:', '').trim()
    } else if (line.startsWith('    enabled:') && current) {
      current.enabled = line.replace('    enabled:', '').trim() !== 'false'
    }
  }
  if (current?.id) sources.push(current as RemoteSkillSource)
  return sources
}

// AI: 将 sources 数组序列化回 YAML
function serializeSourcesYaml(sources: RemoteSkillSource[]): string {
  const lines = [
    '# AI: 远程 Skills 源配置',
    '# 每条记录对应一个远程 skills 网站，修改后无需重启',
    '',
    'sources:',
  ]
  for (const s of sources) {
    lines.push(`  - id: ${s.id}`)
    lines.push(`    name: ${s.name}`)
    lines.push(`    url: ${s.url}`)
    lines.push(`    enabled: ${s.enabled}`)
  }
  return lines.join('\n') + '\n'
}

// AI: 读取配置文件
function readSources(): RemoteSkillSource[] {
  if (!fs.existsSync(CONFIG_PATH)) return []
  const content = fs.readFileSync(CONFIG_PATH, 'utf-8')
  return parseSourcesYaml(content)
}

// AI: 写入配置文件
function writeSources(sources: RemoteSkillSource[]) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, serializeSourcesYaml(sources), 'utf-8')
}

// AI: GET /api/skills/sources — 返回所有远程源
export async function GET() {
  const sources = readSources()
  return NextResponse.json({ sources })
}

// AI: POST /api/skills/sources — 新增远程源
export async function POST(req: NextRequest) {
  const body = await req.json() as { name?: string; url?: string }
  if (!body.url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const sources = readSources()

  // AI: 生成 id（基于 URL 的 hostname）
  let id: string
  try {
    id = new URL(body.url).hostname.replace(/\./g, '-')
  } catch {
    id = `source-${Date.now()}`
  }
  // AI: 避免重复 id
  let finalId = id
  let suffix = 1
  while (sources.some(s => s.id === finalId)) {
    finalId = `${id}-${suffix++}`
  }

  const newSource: RemoteSkillSource = {
    id: finalId,
    name: body.name || body.url,
    url: body.url,
    enabled: true,
  }

  sources.push(newSource)
  writeSources(sources)

  return NextResponse.json({ source: newSource })
}
/* AI end: 远程 Skills 源管理 API */
