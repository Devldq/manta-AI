import { NextResponse } from 'next/server'
import { WORKFLOWS_DIR } from '@/lib/dataStore'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { WorkflowConfig } from '@/lib/types'

interface Params { params: Promise<{ id: string }> }

// AI: GET /api/workflows/[id] — 获取单个工作流配置
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const filePath = path.join(WORKFLOWS_DIR, `${id}.yaml`)
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: '工作流不存在' }, { status: 404 })
  }
  const config = yaml.load(fs.readFileSync(filePath, 'utf-8')) as WorkflowConfig
  return NextResponse.json(config)
}

// AI: PUT /api/workflows/[id] — 更新工作流配置
export async function PUT(req: Request, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const filePath = path.join(WORKFLOWS_DIR, `${id}.yaml`)
  fs.writeFileSync(filePath, yaml.dump({ id, ...body }), 'utf-8')
  return NextResponse.json({ ok: true })
}

// AI: DELETE /api/workflows/[id] — 删除工作流配置
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const filePath = path.join(WORKFLOWS_DIR, `${id}.yaml`)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  return NextResponse.json({ ok: true })
}
