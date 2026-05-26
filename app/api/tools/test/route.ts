/* 工具测试 API — POST /api/tools/test
 * 直接调用 fs-tools 中的工具进行测试
 */
import { NextRequest, NextResponse } from 'next/server'
import { fsToolDefs } from '@/core/tools/file-tools'

// 直接获取工具定义
const tools = new Map<string, (typeof fsToolDefs)[0]>()
for (const tool of fsToolDefs) {
  tools.set(tool.name, tool)
}

export async function POST(req: NextRequest) {
  try {
    const { toolName, input } = await req.json()

    if (!toolName || typeof toolName !== 'string') {
      return NextResponse.json({ error: '缺少 toolName 参数' }, { status: 400 })
    }

    const tool = tools.get(toolName)
    if (!tool) {
      return NextResponse.json({
        error: `工具不存在: ${toolName}`,
        available: Array.from(tools.keys()),
      }, { status: 404 })
    }

    console.log(`[tools/test] 调用 ${toolName}, 输入:`, input)

    const result = await tool.execute(input)
    console.log(`[tools/test] ${toolName} 结果:`, result)

    return NextResponse.json({ toolName, input, result })
  } catch (err) {
    console.error('[tools/test] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
