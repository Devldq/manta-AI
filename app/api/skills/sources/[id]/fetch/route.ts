/* AI start: 远程 Skills 源内容抓取 API — 服务端代理请求，解决客户端跨域问题 */
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

// AI: 解析 YAML 获取源列表
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

export interface RemoteSkillItem {
  name: string
  description: string
  version?: string
  installCmd?: string
  homepage?: string
  tags?: string[]
}

export interface FetchResult {
  sourceId: string
  sourceName: string
  url: string
  status: 'ok' | 'error' | 'disabled'
  skills: RemoteSkillItem[]
  rawTitle?: string
  error?: string
  fetchedAt: string
}

// AI: 从 HTML 中提取 skills.sh 风格的 skills 列表
function parseSkillsSh(html: string, baseUrl: string): RemoteSkillItem[] {
  const skills: RemoteSkillItem[] = []

  // AI: 匹配 skills.sh 卡片格式（根据实际 HTML 结构做通用提取）
  // 先尝试 JSON-LD / meta 中的结构化数据
  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const inner = block.replace(/<script[^>]*>/, '').replace('</script>', '')
        const data = JSON.parse(inner)
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item.name && (item['@type'] === 'SoftwareApplication' || item['@type'] === 'WebApplication')) {
            skills.push({
              name: item.name,
              description: item.description || '',
              version: item.version,
              homepage: item.url || baseUrl,
            })
          }
        }
      } catch { /* silent */ }
    }
  }

  if (skills.length > 0) return skills

  // AI: 通用提取 — 抓取 <h2>/<h3> + 相邻 <p> 段落作为 skill 条目
  const headingPattern = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/i
  const linkPattern = /href="([^"]+)"/i

  let match: RegExpExecArray | null
  while ((match = headingPattern.exec(html)) !== null) {
    const titleRaw = match[1].replace(/<[^>]+>/g, '').trim()
    if (!titleRaw || titleRaw.length > 80) continue

    // AI: 截取 heading 后面一小段 HTML，找相邻的 <p>
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 800)
    const pMatch = pPattern.exec(after)
    const desc = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : ''

    // AI: 找 <a href> 作为 homepage
    const linkMatch = linkPattern.exec(after)
    let homepage: string | undefined
    if (linkMatch) {
      const href = linkMatch[1]
      homepage = href.startsWith('http') ? href : new URL(href, baseUrl).toString()
    }

    skills.push({ name: titleRaw, description: desc.slice(0, 200), homepage })
  }

  // AI: 去重（按 name）
  const seen = new Set<string>()
  return skills.filter(s => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  }).slice(0, 50) // AI: 最多返回 50 条，避免噪音
}

// AI: GET /api/skills/sources/[id]/fetch — 抓取并解析指定远程源
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!fs.existsSync(CONFIG_PATH)) {
    return NextResponse.json({ error: 'config not found' }, { status: 404 })
  }

  const sources = parseSourcesYaml(fs.readFileSync(CONFIG_PATH, 'utf-8'))
  const source = sources.find(s => s.id === id)

  if (!source) {
    return NextResponse.json({ error: 'source not found' }, { status: 404 })
  }

  if (!source.enabled) {
    const result: FetchResult = {
      sourceId: source.id,
      sourceName: source.name,
      url: source.url,
      status: 'disabled',
      skills: [],
      fetchedAt: new Date().toISOString(),
    }
    return NextResponse.json(result)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 ARM-Skills-Browser/1.0',
        'Accept': 'text/html,application/json,*/*',
      },
    })
    clearTimeout(timeout)

    const contentType = res.headers.get('content-type') ?? ''
    let skills: RemoteSkillItem[] = []
    let rawTitle = ''

    if (contentType.includes('application/json')) {
      // AI: JSON 格式（如自托管的 skills registry API）
      const json = await res.json()
      const items: unknown[] = Array.isArray(json) ? json : (json.skills ?? json.packages ?? json.items ?? [])
      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          const i = item as Record<string, unknown>
          skills.push({
            name: String(i.name ?? ''),
            description: String(i.description ?? ''),
            version: i.version ? String(i.version) : undefined,
            installCmd: i.install ? String(i.install) : (i.name ? `npx skills add ${i.name}` : undefined),
            homepage: i.homepage ? String(i.homepage) : undefined,
            tags: Array.isArray(i.tags) ? i.tags.map(String) : undefined,
          })
        }
      }
    } else {
      // AI: HTML 格式
      const html = await res.text()
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      rawTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : ''
      skills = parseSkillsSh(html, source.url)
    }

    const result: FetchResult = {
      sourceId: source.id,
      sourceName: source.name,
      url: source.url,
      status: 'ok',
      skills,
      rawTitle,
      fetchedAt: new Date().toISOString(),
    }
    return NextResponse.json(result)
  } catch (err: unknown) {
    const result: FetchResult = {
      sourceId: source.id,
      sourceName: source.name,
      url: source.url,
      status: 'error',
      skills: [],
      error: (err as Error).message ?? 'fetch failed',
      fetchedAt: new Date().toISOString(),
    }
    return NextResponse.json(result)
  }
}
/* AI end: 远程 Skills 源内容抓取 API */
