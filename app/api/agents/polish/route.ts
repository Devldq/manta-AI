/*  start: AI 润色 SOUL.md — 根据用户输入的描述/职责生成完整的 SOUL.md */
import { NextRequest, NextResponse } from 'next/server'

// AI: 润色请求参数
interface PolishRequest {
  name?: string
  description?: string
  responsibilities?: string
  workflow?: string
  currentSoul?: string
}

// AI: 使用 OpenAI 兼容接口生成 SOUL.md
async function polishSoul(req: PolishRequest): Promise<string> {
  // AI: 从环境变量读取配置
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-4o-mini'

  if (!apiKey) {
    throw new Error('NO_API_KEY')  // AI: 特殊错误码，便于前端识别并降级
  }

  // AI: 构建系统提示词
  const systemPrompt = `你是一个专业的 AI Agent 架构师，擅长编写清晰、结构化的 Agent SOUL.md 文档。
SOUL.md 是 Agent 的核心定义文档，包含身份、职责、工作流程等关键信息。

请根据用户提供的信息，生成一份完整、专业的 SOUL.md 文档。
要求：
1. 使用 Markdown 格式
2. 包含以下核心章节：# Agent · SOUL、## 身份、## 职责、## 工作流程
3. 内容简洁明了，突出 Agent 的核心价值和工作方式
4. 如果用户提供的信息不完整，请合理推断补充
5. 保持专业、务实的语气，避免过度营销化`

  // AI: 构建用户输入提示词
  const userPrompt = buildUserPrompt(req)

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI API 请求失败: ${response.status} ${error}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('AI API 返回内容为空')
    }

    return content.trim()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`AI 润色失败: ${message}`)
  }
}

// AI: 根据请求参数构建用户提示词
function buildUserPrompt(req: PolishRequest): string {
  const parts: string[] = []

  if (req.name) {
    parts.push(`Agent 名称：${req.name}`)
  }

  if (req.description) {
    parts.push(`简介描述：${req.description}`)
  }

  if (req.responsibilities) {
    parts.push(`核心职责：${req.responsibilities}`)
  }

  if (req.workflow) {
    parts.push(`工作流程：${req.workflow}`)
  }

  if (req.currentSoul) {
    parts.push(`\n当前 SOUL.md：\n${req.currentSoul}`)
    parts.push('\n请基于以上信息，优化改进这份 SOUL.md 文档。')
  } else {
    parts.push('\n请根据以上信息，生成一份完整的 SOUL.md 文档。')
  }

  return parts.join('\n')
}

// AI: POST /api/agents/polish — AI 润色 SOUL.md
export async function POST(req: NextRequest) {
  try {
    const body: PolishRequest = await req.json()
    const polished = await polishSoul(body)
    return NextResponse.json({ success: true, soul: polished })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 润色失败'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
/*  end: AI 润色 SOUL.md API 结束 */
