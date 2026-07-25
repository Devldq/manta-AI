export const PUBLIC_TOOL_REASON_FIELD = '__manta_public_reason'

const PUBLIC_REASON_SCHEMA = {
  type: 'string',
  minLength: 8,
  maxLength: 240,
  description: [
    'Required user-visible action rationale.',
    'MUST use the same language as the user latest message（必须使用用户最新消息的语言）.',
    'In one or two concise sentences, state the concrete finding or uncertainty so far,',
    'why this tool is the next action, and what its result will verify.',
    'Write like a natural collaborator: prefer a concrete finding followed by the next move.',
    'Do not narrate the literal tool operation or repeat its file path/input when the UI already shows it.',
    'Connect each action to fresh evidence from the previous result, and vary sentence structure across consecutive actions.',
    'For Chinese, avoid repetitive report-style openings such as “需要查看…” or “为了了解…”,',
    'also avoid repeatedly starting with “我先…”, “我正在…” or “接下来…”,',
    'and avoid boilerplate endings such as “这将帮助我们…”.',
    'Good examples: “目录里只有一个公开入口，我沿着它的导出关系进入核心实现。”',
    '“engine.ts 把检索交给 Pipeline；再核对 pipeline.ts 就能锁定主调用链。”',
    'Do not reveal private chain-of-thought or generic process narration.',
  ].join(' '),
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function withPublicToolReason(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []

  return {
    ...schema,
    type: 'object',
    properties: {
      ...properties,
      [PUBLIC_TOOL_REASON_FIELD]: PUBLIC_REASON_SCHEMA,
    },
    required: [...new Set([...required, PUBLIC_TOOL_REASON_FIELD])],
  }
}

export function getPublicToolReason(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const value = input[PUBLIC_TOOL_REASON_FIELD]
  if (typeof value !== 'string') return undefined
  const reason = value.trim()
  return reason.length > 0 ? reason : undefined
}

export function normalizePublicToolReason(value: string): string | undefined {
  const reason = value.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (reason.length < 8) return undefined
  if (
    /<\/?tool_call>|<\/?arg_(?:key|value)>/i.test(reason)
    || /^(?:next tool|tool input)\s*:/i.test(reason)
    || /^```/.test(reason)
    || (/^\s*[{[]/.test(reason) && /["'}\]]\s*$/.test(reason))
  ) {
    return undefined
  }
  return reason
}

export function matchesUserLanguage(reason: string, userPrompt: string | undefined): boolean {
  if (!userPrompt) return true
  const userUsesCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(userPrompt)
  if (!userUsesCjk) return true
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(reason)
}

export function setPublicToolReason(input: unknown, reason: string): unknown {
  if (!isRecord(input)) return input
  return {
    ...withoutPublicToolReason(input) as Record<string, unknown>,
    [PUBLIC_TOOL_REASON_FIELD]: reason,
  }
}

export function validatePublicToolInput(input: unknown) {
  const rawReason = getPublicToolReason(input)
  const reason = rawReason ? normalizePublicToolReason(rawReason) : undefined
  if (!reason || rawReason!.length > 240) {
    return {
      success: false as const,
      error: new Error('PUBLIC_TOOL_REASON_REQUIRED'),
    }
  }
  return { success: true as const, value: input }
}

export function withoutPublicToolReason(input: unknown): unknown {
  if (!isRecord(input) || !(PUBLIC_TOOL_REASON_FIELD in input)) return input
  const clean = { ...input }
  delete clean[PUBLIC_TOOL_REASON_FIELD]
  return clean
}
