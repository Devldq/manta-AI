import { NextResponse } from 'next/server'
import { WORKFLOWS_DIR, ensureDir } from '@/lib/dataStore'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { WorkflowConfig } from '@/lib/types'

// AI: GET /api/workflows — 获取所有工作流配置
export async function GET() {
  ensureDir(WORKFLOWS_DIR)
  const files = fs.existsSync(WORKFLOWS_DIR)
    ? fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    : []

  const workflows: WorkflowConfig[] = files.map(f => {
    const content = fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8')
    return yaml.load(content) as WorkflowConfig
  })
  return NextResponse.json(workflows)
}

// AI: POST /api/workflows — 创建或保存工作流配置
export async function POST(req: Request) {
  ensureDir(WORKFLOWS_DIR)
  const body = await req.json()
  const { id, ...rest } = body
  if (!id) return NextResponse.json({ error: '缺少 id 字段' }, { status: 400 })
  const filePath = path.join(WORKFLOWS_DIR, `${id}.yaml`)
  fs.writeFileSync(filePath, yaml.dump({ id, ...rest }), 'utf-8')
  return NextResponse.json({ ok: true })
}
