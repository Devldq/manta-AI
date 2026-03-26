import { NextResponse } from 'next/server'
import { adjustHealth, cloneAgent, spawnReplacementAgent, getAgentStats, AGENT_DISPLAY_NAMES } from '@/lib/agentLifecycle'
import { sendMacNotification } from '@/lib/macNotify'

// AI: POST /api/score-agent — 打分接口（ok: +10 / x: -10）
export async function POST(req: Request) {
  const { agentId, action } = await req.json()
  // action: 'ok' | 'x'
  if (!agentId || !['ok', 'x'].includes(action)) {
    return NextResponse.json({ error: '参数错误，action 必须是 ok 或 x' }, { status: 400 })
  }

  const delta = action === 'ok' ? 10 : -10
  const { stats, event } = adjustHealth(agentId, delta)

  // AI: 根据事件类型推送 Mac 通知
  if (event === 'can_clone') {
    await sendMacNotification({
      title: '🌟 可以复制 Agent！',
      message: `${AGENT_DISPLAY_NAMES[agentId] ?? agentId} 生命值达到 ${stats.health} 分，可以复制啦！`,
      agentId,
      type: 'info',
    })
  } else if (event === 'banned') {
    // AI: 自动生成替代 Agent
    const replacement = spawnReplacementAgent(agentId)
    await sendMacNotification({
      title: '🚫 Agent 已封禁',
      message: `${AGENT_DISPLAY_NAMES[agentId] ?? agentId} 生命值归零，已封禁。替代 Agent ${replacement.agentId} 已生成。`,
      agentId,
      type: 'warning',
    })
    return NextResponse.json({ stats, event, replacement })
  }

  return NextResponse.json({ stats, event })
}
