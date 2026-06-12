/* Workspace 配置 API — GET/POST /api/config/workspace */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceConfig, setDefaultWorkDir, addRecentDir, type WorkspaceConfig } from '@storage/config/workspace-store'
import * as fs from 'fs'
import * as path from 'path'

export async function GET() {
  try {
    const config = getWorkspaceConfig()
    return NextResponse.json({ config })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // 设置默认工作目录
    if (body.setDefaultDir) {
      const dir = body.setDefaultDir
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return NextResponse.json({ error: `目录不存在或不是有效目录: ${dir}` }, { status: 400 })
      }
      setDefaultWorkDir(dir)
      return NextResponse.json({ success: true, defaultDir: path.resolve(dir) })
    }

    // 添加最近使用目录
    if (body.addRecentDir) {
      addRecentDir(body.addRecentDir)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
