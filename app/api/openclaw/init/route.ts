import { NextResponse } from 'next/server'
import { checkArmInitStatus, runInitScript, getAllOcAgents } from '@/lib/openclawIntegration'

// AI: GET /api/openclaw/init — 检查 ARM agents 初始化状态
export async function GET() {
  const status = checkArmInitStatus()
  const allAgents = getAllOcAgents()
  return NextResponse.json({
    ...status,
    totalOcAgents: allAgents.length,
    ocAgents: allAgents.map(a => ({
      id: a.id,
      isArmAgent: a.isArmAgent,
      workspaceExists: a.workspaceExists,
      status: a.status,
      allowAgents: a.allowAgents,
    })),
  })
}

// AI: POST /api/openclaw/init — 执行初始化脚本（注册 ARM agents 到 OpenClaw）
export async function POST() {
  const status = checkArmInitStatus()

  if (!status.isOpenclawAvailable) {
    return NextResponse.json(
      { success: false, message: 'OpenClaw 未安装或未初始化，请先安装 OpenClaw' },
      { status: 400 }
    )
  }

  if (status.allRegistered) {
    return NextResponse.json({
      success: true,
      message: '所有 ARM Agents 已注册，无需重复初始化',
      alreadyInitialized: true,
    })
  }

  const result = runInitScript()
  return NextResponse.json({
    success: result.success,
    message: result.success ? 'ARM Agents 初始化成功' : '初始化失败',
    output: result.output,
    alreadyInitialized: false,
  })
}
