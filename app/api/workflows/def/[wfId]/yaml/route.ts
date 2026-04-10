/*  start: 工作流 YAML 读取/写入 API — GET/PUT /api/workflows/def/[wfId]/yaml */
import * as fs from 'fs'
import * as path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { loadAllWorkflows } from '@/core/workflow-engine/loader'

// AI: workflows 目录路径
const WORKFLOWS_DIR = path.join(process.cwd(), 'workflows')

// AI: 根据 workflowId 查找对应的 YAML 文件路径
function findYamlFilePath(wfId: string): string | null {
  if (!fs.existsSync(WORKFLOWS_DIR)) return null

  const files = fs.readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))

  for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      // AI: 简单解析 id: 字段匹配（不完整解析，只找 id 行）
      const idMatch = content.match(/^id:\s*["']?([^"'\n\r]+)["']?/m)
      if (idMatch && idMatch[1].trim() === wfId) {
        return filePath
      }
    } catch {
      // 忽略读取错误
    }
  }
  return null
}

/** GET /api/workflows/def/[wfId]/yaml — 读取工作流 YAML 原文 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wfId: string }> }
) {
  const { wfId } = await params

  try {
    const filePath = findYamlFilePath(wfId)
    if (!filePath) {
      return NextResponse.json({ error: `工作流 "${wfId}" 不存在` }, { status: 404 })
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const fileName = path.basename(filePath)

    return NextResponse.json({ yaml: content, fileName })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** PUT /api/workflows/def/[wfId]/yaml — 写入工作流 YAML（覆盖） */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ wfId: string }> }
) {
  const { wfId } = await params

  try {
    const body = await req.json()
    const { yaml } = body

    if (!yaml || typeof yaml !== 'string') {
      return NextResponse.json({ error: 'yaml 内容不能为空' }, { status: 400 })
    }

    // AI: 校验 YAML 是否包含 id 字段（基础合法性检查）
    const idMatch = yaml.match(/^id:\s*["']?([^"'\n\r]+)["']?/m)
    if (!idMatch) {
      return NextResponse.json({ error: 'YAML 中缺少 id 字段' }, { status: 400 })
    }

    const yamlWfId = idMatch[1].trim()

    let filePath = findYamlFilePath(wfId)

    if (!filePath) {
      // AI: 工作流不存在时，创建新文件（以 wfId 作为文件名）
      if (!fs.existsSync(WORKFLOWS_DIR)) {
        fs.mkdirSync(WORKFLOWS_DIR, { recursive: true })
      }
      filePath = path.join(WORKFLOWS_DIR, `${yamlWfId}.yaml`)
    }

    // AI: 原子写入（先写临时文件再重命名）
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, yaml, 'utf-8')
    fs.renameSync(tmp, filePath)

    // AI: 返回更新后解析的工作流定义
    const allWorkflows = loadAllWorkflows()
    const updated = allWorkflows.find((w) => w.id === yamlWfId) ?? null

    return NextResponse.json({ ok: true, workflow: updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 工作流 YAML 读取/写入 API 结束 */
