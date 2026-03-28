/*  start: Agent 定义文件读写 API — GET 读取内容 / PUT 保存修改 */
// AI: 通过 agent name 查找对应的 filePath，直接读写原始文件
// openclaw agents (fileReadonly=true): 只读展示，不允许修改（含 API key）
// claude/codeflicker agents: 可读可写
import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import { loadAgents } from '@/registry'

// AI: GET /api/agents/definition?name=<agentName> — 读取 agent 定义文件内容
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')
  if (!name) {
    return NextResponse.json({ error: '缺少 name 参数' }, { status: 400 })
  }

  const agents = loadAgents()
  const agent = agents.find((a) => a.name === name)
  if (!agent) {
    return NextResponse.json({ error: `未找到 agent: ${name}` }, { status: 404 })
  }

  // AI: 无定义文件路径（如 openclaw 中 agentDir 为空的 agent）
  if (!agent.filePath) {
    return NextResponse.json({
      name: agent.name,
      content: null,
      filePath: null,
      readonly: true,
      message: '该 Agent 无可查看的定义文件（agentDir 为空）',
    })
  }

  try {
    const content = fs.readFileSync(agent.filePath, 'utf-8')
    return NextResponse.json({
      name: agent.name,
      content,
      filePath: agent.filePath,
      readonly: agent.fileReadonly ?? false,
      pluginId: agent.pluginId,
    })
  } catch (err) {
    return NextResponse.json({ error: `读取文件失败: ${String(err)}` }, { status: 500 })
  }
}

// AI: PUT /api/agents/definition — 保存修改后的 agent 定义文件
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { name, content } = body

  if (!name || content === undefined) {
    return NextResponse.json({ error: '缺少 name 或 content 参数' }, { status: 400 })
  }

  const agents = loadAgents()
  const agent = agents.find((a) => a.name === name)
  if (!agent) {
    return NextResponse.json({ error: `未找到 agent: ${name}` }, { status: 404 })
  }

  // AI: 只读文件（如 openclaw models.json）不允许修改
  if (agent.fileReadonly) {
    return NextResponse.json({ error: '该 Agent 定义文件为只读，无法修改' }, { status: 403 })
  }

  if (!agent.filePath) {
    return NextResponse.json({ error: '该 Agent 无定义文件路径' }, { status: 404 })
  }

  try {
    // AI: 写前先备份（同目录 .bak 文件）
    const bakPath = agent.filePath + '.bak'
    if (fs.existsSync(agent.filePath)) {
      fs.copyFileSync(agent.filePath, bakPath)
    }
    fs.writeFileSync(agent.filePath, content, 'utf-8')
    return NextResponse.json({ success: true, filePath: agent.filePath })
  } catch (err) {
    return NextResponse.json({ error: `写入文件失败: ${String(err)}` }, { status: 500 })
  }
}
/*  end: Agent 定义文件读写 API 结束 */
