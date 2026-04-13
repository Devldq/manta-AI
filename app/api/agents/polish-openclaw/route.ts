/*  start: 使用女娲 Agent 实现 AI 润色 — 专业的 Agent 创造者 */
import { NextRequest, NextResponse } from 'next/server'
import * as path from 'path'
import * as os from 'os'
import { getRunner } from '@/core/runner'
import type { AgentEntry, Task } from '@/core/types'
import * as fs from 'fs'

// AI: 润色请求参数
interface PolishRequest {
  name?: string
  description?: string
  responsibilities?: string
  workflow?: string
  currentSoul?: string
}

// AI: 获取女娲 Agent
function getNuwaAgent(): AgentEntry | null {
  // AI: 女娲 Agent 的标准配置
  return {
    name: 'nuwa',
    runnerId: 'openclaw',
    description: '女娲 - 元级 Agent 架构师，专门创造其他 Agent',
    enabled: true,
    source: 'plugin-native',
    pluginId: 'openclaw',
  }
}

// AI: 构建符合女娲期望的提示词
function buildPromptForNuwa(req: PolishRequest): string {
  const parts: string[] = []

  // AI: 如果是优化现有 SOUL
  if (req.currentSoul) {
    parts.push('请帮我优化改进以下 Agent 的 SOUL.md：\n')
    parts.push(`Agent 名称：${req.name || '未知'}`)
    if (req.description) parts.push(`描述：${req.description}`)
    parts.push('\n当前 SOUL.md：')
    parts.push('```markdown')
    parts.push(req.currentSoul)
    parts.push('```')
    parts.push('\n改进方向：')
    if (req.responsibilities) parts.push(`- 补充职责：${req.responsibilities}`)
    if (req.workflow) parts.push(`- 补充流程：${req.workflow}`)
    parts.push('\n请生成优化后的完整 SOUL.md。')
  } else {
    // AI: 创建新 SOUL
    parts.push('请帮我创建一个新的 Agent，具体信息如下：\n')
    if (req.name) parts.push(`Agent 名称：${req.name}`)
    if (req.description) parts.push(`简介描述：${req.description}`)
    if (req.responsibilities) parts.push(`核心职责：${req.responsibilities}`)
    if (req.workflow) parts.push(`工作流程：${req.workflow}`)
    parts.push('\n请生成完整的 SOUL.md 文档。')
  }

  return parts.join('\n')
}

// AI: 解析女娲的输出，提取 SOUL.md
function extractSoulFromOutput(output: string): string {
  // AI: 女娲会生成完整的 SOUL.md，通常包含在 markdown 代码块中
  const codeBlockMatch = output.match(/```markdown\n([\s\S]+?)\n```/)
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim()
  }

  // AI: 或者直接以 "# Agent · SOUL" 开头
  const soulMatch = output.match(/(# Agent · SOUL[\s\S]+)/m)
  if (soulMatch) {
    return soulMatch[1].trim()
  }

  // AI: 如果都没匹配到，返回原始输出
  return output.trim()
}

// AI: POST /api/agents/polish-openclaw — 使用女娲 Agent 润色
export async function POST(req: NextRequest) {
  try {
    // 1. 获取女娲 Agent
    const nuwaAgent = getNuwaAgent()
    if (!nuwaAgent) {
      return NextResponse.json(
        { success: false, error: '女娲 Agent 未找到，请先创建女娲 Agent' },
        { status: 500 }
      )
    }

    // 2. 获取 OpenClaw Runner
    const runner = getRunner('openclaw')
    if (!runner) {
      return NextResponse.json(
        { success: false, error: 'OpenClaw Runner 不可用' },
        { status: 500 }
      )
    }

    // 3. 构建提示词
    const body: PolishRequest = await req.json()
    const prompt = buildPromptForNuwa(body)

    // 4. 准备输出目录
    const outputDir = path.join(os.tmpdir(), `manta-polish-${Date.now()}`)

    // 5. 准备任务对象（符合 Runner 接口要求）
    const taskId = `polish-${Date.now()}`
    const task: Task = {
      id: taskId,
      title: 'AI 润色 SOUL.md',
      description: prompt, // AI: 直接把提示词放到 description 字段
      mode: 'agent',
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentName: 'nuwa',
    }

    // 6. 调用女娲 Agent
    const result = await runner.run({
      agent: nuwaAgent,
      task,
      outputDir,
    })

    // 7. 检查执行结果
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: `女娲执行失败: ${result.error || 'unknown error'}` },
        { status: 500 }
      )
    }

    // 8. 读取输出文件
    let output = ''
    if (result.outputFiles && result.outputFiles.length > 0) {
      try {
        output = fs.readFileSync(result.outputFiles[0], 'utf-8')
      } catch (err) {
        return NextResponse.json(
          { success: false, error: `无法读取输出文件: ${err}` },
          { status: 500 }
        )
      }
    }

    if (!output) {
      return NextResponse.json(
        { success: false, error: '女娲未返回任何内容' },
        { status: 500 }
      )
    }

    // 9. 提取 SOUL.md
    const soul = extractSoulFromOutput(output)

    if (!soul || soul.length < 50) {
      return NextResponse.json(
        { success: false, error: '女娲返回的 SOUL.md 内容不完整' },
        { status: 500 }
      )
    }

    // 10. 返回结果
    return NextResponse.json({ success: true, soul })
  } catch (err) {
    const message = err instanceof Error ? err.message : '女娲润色失败'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
/*  end: 女娲 Agent 润色 API 结束 */
