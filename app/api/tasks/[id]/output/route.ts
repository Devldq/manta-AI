/*  start: 任务输出文件读取 API — GET /api/tasks/[id]/output */
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { dataStore } from '@/core/workflow-engine'

interface RouteContext {
  params: Promise<{ id: string }>
}

// AI: 优先读取的输出文件名（按优先级排序）
const PRIORITY_FILES = [
  'output.md',
  'output.txt',
  'result.md',
  'result.txt',
  'summary.md',
  'dev-summary.md',
  'frontend-design.md',
  'qa-report.md',
  'cr-report.md',
]

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  try {
    const task = await dataStore.getTask(id)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }

    if (!task.outputDir) {
      return NextResponse.json({ content: null, files: [] })
    }

    // AI: 展开 ~ 到实际路径
    const outputDir = task.outputDir.startsWith('~')
      ? task.outputDir.replace('~', os.homedir())
      : task.outputDir

    if (!fs.existsSync(outputDir)) {
      return NextResponse.json({ content: null, files: [] })
    }

    // AI: 列出输出目录下的所有文件
    const allFiles = fs.readdirSync(outputDir)
      .filter((f) => !f.startsWith('.') && f !== 'task-context.json')
      .map((f) => ({
        name: f,
        path: path.join(outputDir, f),
        size: fs.statSync(path.join(outputDir, f)).size,
      }))

    if (allFiles.length === 0) {
      return NextResponse.json({ content: null, files: [] })
    }

    // AI: 按优先级找最合适的文件来展示
    let targetFile = allFiles.find((f) => PRIORITY_FILES.includes(f.name))
    if (!targetFile) {
      // AI: 找第一个文本文件
      targetFile = allFiles.find((f) =>
        /\.(md|txt|json|yaml|yml|log)$/.test(f.name)
      )
    }
    if (!targetFile) {
      targetFile = allFiles[0]
    }

    // AI: 读取文件内容（最多 50KB，防止大文件撑爆界面）
    const content = fs.readFileSync(targetFile.path, 'utf-8').slice(0, 50 * 1024)

    return NextResponse.json({
      content,
      file: targetFile.name,
      files: allFiles.map((f) => f.name),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
/*  end: 任务输出文件读取 API 结束 */
