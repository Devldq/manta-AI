/*  start: OpenClaw Agent 单个操作 — DELETE 删除 */
import { NextRequest, NextResponse } from 'next/server'
import { getAgentOps } from '@/plugins/loader'

// AI: DELETE /api/agents/openclaw/[name] — 删除 openclaw agent
// 从 openclaw.json 的 agents.list 中移除记录（workspace 目录保留）
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params

  try {
    // AI: 通过插件接口删除 agent
    const ops = getAgentOps('openclaw')
    if (!ops) {
      return NextResponse.json(
        { error: 'OpenClaw 插件不可用' },
        { status: 500 }
      )
    }

    // AI: 检查 agent 是否存在
    const exists = await ops.agentExists(name)
    if (!exists) {
      return NextResponse.json(
        { error: `Agent "${name}" 不存在` },
        { status: 404 }
      )
    }

    // AI: 删除 agent（从配置文件移除，workspace 保留）
    await ops.deleteAgent(name)

    return NextResponse.json({
      success: true,
      name,
      message: '已从 openclaw.json 移除，workspace 目录已保留',
    })
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}
/*  end: OpenClaw Agent 删除 API 结束 */
