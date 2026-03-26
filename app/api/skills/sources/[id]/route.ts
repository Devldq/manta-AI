/* AI start: 远程 Skills 源 [id] API — PUT 更新 / DELETE 删除 */
import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'skills-sources.yaml')

interface RemoteSkillSource {
  id: string
  name: string
  url: string
  enabled: boolean
}

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

function readSources(): RemoteSkillSource[] {
  if (!fs.existsSync(CONFIG_PATH)) return []
  return parseSourcesYaml(fs.readFileSync(CONFIG_PATH, 'utf-8'))
}

function writeSources(sources: RemoteSkillSource[]) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, serializeSourcesYaml(sources), 'utf-8')
}

// AI: PUT /api/skills/sources/[id] — 更新指定远程源（name、url、enabled）
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json() as Partial<RemoteSkillSource>
  const sources = readSources()
  const idx = sources.findIndex(s => s.id === id)
  if (idx === -1) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  sources[idx] = { ...sources[idx], ...body, id }
  writeSources(sources)
  return NextResponse.json({ source: sources[idx] })
}

// AI: DELETE /api/skills/sources/[id] — 删除指定远程源
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const sources = readSources()
  const filtered = sources.filter(s => s.id !== id)
  if (filtered.length === sources.length) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  writeSources(filtered)
  return NextResponse.json({ ok: true })
}
/* AI end: 远程 Skills 源 [id] API */
