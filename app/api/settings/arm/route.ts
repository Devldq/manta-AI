import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { loadArmConfig } from '@/config/arm'

const CONFIG_PATH = path.join(process.cwd(), 'config', 'arm.yaml')

// AI: GET /api/settings/arm — 读取当前 ARM 触发配置
export async function GET() {
  const config = loadArmConfig()
  return NextResponse.json(config)
}

// AI: PUT /api/settings/arm — 写入 ARM 触发配置（部分更新）
export async function PUT(req: Request) {
  try {
    const body = await req.json()

    // AI: 读取现有配置，合并更新字段
    const current = loadArmConfig()
    const updated = {
      ...current,
      ...body,
      im: { ...current.im, ...(body.im ?? {}) },
      local: { ...current.local, ...(body.local ?? {}) },
      agent_ids: { ...current.agent_ids, ...(body.agent_ids ?? {}) },
    }

    // AI: 写回 YAML，保留注释头
    const header = `# ARM · Agent 触发配置\n# 修改此文件后无需重启，下次触发时自动生效\n\n`
    const content = header + yaml.dump(updated, { lineWidth: 120 })
    fs.writeFileSync(CONFIG_PATH, content, 'utf-8')

    return NextResponse.json(updated)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
