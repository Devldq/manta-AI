/* GET /api/chat/config — 读取 LLM 配置（apiKey 脱敏）
   PUT /api/chat/config — 保存 LLM 配置
   POST /api/chat/config/test — 测试连通性 */
import { NextRequest, NextResponse } from 'next/server'
import { getLLMConfig, getLLMConfigMasked, saveLLMConfig } from '@/core/llm/config-store'
import { testLLMConnection } from '@/core/llm/factory'
import type { LLMConfig } from '@/core/llm/types'

export async function GET() {
  try {
    const config = getLLMConfigMasked()
    return NextResponse.json({ config })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const incoming = body as LLMConfig

    if (!incoming.provider || !incoming.model) {
      return NextResponse.json({ error: 'provider 和 model 为必填项' }, { status: 400 })
    }

    // AI: 合并保存 — 如果本次请求没有传入 apiKey（UI 里未输入新 Key），
    //     则保留之前已存储的 apiKey，避免脱敏显示时的"空覆盖"问题
    if (!incoming.apiKey?.trim()) {
      const existing = getLLMConfig()
      incoming.apiKey = existing.apiKey
    }

    saveLLMConfig(incoming)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // AI: POST /api/chat/config — 测试 LLM 连通性
  try {
    const body = await req.json()
    const incoming = body as LLMConfig

    if (!incoming.provider || !incoming.model) {
      return NextResponse.json({ error: 'provider 和 model 为必填项' }, { status: 400 })
    }

    // AI: 测试时同样合并已存储的 apiKey，保证测试结果真实反映实际配置
    if (!incoming.apiKey?.trim()) {
      const existing = getLLMConfig()
      incoming.apiKey = existing.apiKey
    }

    const result = await testLLMConnection(incoming)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
