/**
 * Prompt Pipe — 模块化 Prompt 组装
 *
 * 将 system prompt 拆解为可组合的管道函数（PipeFn），
 * 每个 pipe 根据 PromptContext 决定是否输出以及输出什么内容。
 * 支持运行时 debug 和 per-pipe token 消耗统计。
 */

import { logger } from '@observability/log'
import { getToolRegistry } from '@tools/mcp/setup'
import { estimateTokensFromChars } from '@context/token/estimator'
import { getMemoryStore } from '@storage/memory'

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** 每个 pipe 的统计信息（用于日志输出 token 消耗） */
export interface PipeStats {
  name: string
  enabled: boolean
  charCount: number
  /** 估算 token 数（英文约 4 chars/token，中英文混合约 2.5） */
  estimatedTokens: number
}

/** buildWithStats 的返回结果 */
export interface BuildResult {
  prompt: string
  stats: PipeStats[]
  totalChars: number
  totalEstimatedTokens: number
  enabledCount: number
  disabledCount: number
}

/** 管道上下文 — 每个 pipe 共享的运行时信息 */
export interface PromptContext {
  /** 当前已注册的工具总数 */
  toolCount: number
  /** 延迟工具摘要文本（由 getDeferredToolSummary 生成） */
  deferredToolSummary: string
  /** 当前会话的历史消息条数 */
  sessionMessageCount: number
  /** 会话 ID */
  sessionId: string
}

/** Pipe 函数：接收上下文，返回 prompt 片段或 null（跳过） */
export type PipeFn = (ctx: PromptContext) => string | null

// ─── PromptBuilder ─────────────────────────────────────────────────────────────

// estimateTokensFromChars 统一使用 token-estimator.ts（chars/4 * 1.2 中文安全系数）

export class PromptBuilder {
  private pipes: Array<{ name: string; fn: PipeFn }> = []

  /** 注册一个 pipe，返回 this 以支持链式调用 */
  pipe(name: string, fn: PipeFn): this {
    this.pipes.push({ name, fn })
    return this
  }

  /** 构建最终 prompt 字符串 */
  build(ctx: PromptContext): string {
    return this.buildWithStats(ctx).prompt
  }

  /** 构建 prompt 并返回 per-pipe 统计信息 */
  buildWithStats(ctx: PromptContext): BuildResult {
    const sections: string[] = []
    const stats: PipeStats[] = []

    for (const { name, fn } of this.pipes) {
      const result = fn(ctx)
      const enabled = result !== null
      if (enabled) {
        sections.push(result)
      }
      stats.push({
        name,
        enabled,
        charCount: enabled ? result!.length : 0,
        estimatedTokens: enabled ? estimateTokensFromChars(result!.length) : 0,
      })
    }

    const totalChars = stats.reduce((sum, s) => sum + s.charCount, 0)
    const totalEstimatedTokens = stats.reduce((sum, s) => sum + s.estimatedTokens, 0)
    const enabledCount = stats.filter(s => s.enabled).length
    const disabledCount = stats.filter(s => !s.enabled).length

    return {
      prompt: sections.join('\n\n'),
      stats,
      totalChars,
      totalEstimatedTokens,
      enabledCount,
      disabledCount,
    }
  }

  /**
   * Debug 输出 — 打印各 pipe 状态到控制台
   * 同时返回 stats 数组供日志系统使用
   */
  debug(ctx: PromptContext): PipeStats[] {
    const { stats, totalChars, enabledCount, disabledCount } = this.buildWithStats(ctx)

    const lines: string[] = [
      '',
      '=== Prompt Pipe Debug ===',
    ]
    for (const stat of stats) {
      const status = stat.enabled
        ? `[ON]  ${stat.charCount} chars (~${stat.estimatedTokens} tokens)`
        : `[OFF]`
      lines.push(`  ${stat.name}: ${status}`)
    }
    lines.push(
      `---`,
      `  Total: ${totalChars} chars, ${enabledCount} on / ${disabledCount} off`,
      '========================',
      '',
    )
    console.log(lines.join('\n'))

    return stats
  }
}

// ─── 预设 Pipe 工厂函数 ───────────────────────────────────────────────────────

/** 核心行为规则：身份定位 + 通信风格 + 行动安全 + 代码风格 + 代码引用 + 安全边界 */
export function coreRules(): PipeFn {
  return () => `# Identity

You are Manta, an AI assistant in an Agent OS desktop app. The user will primarily request you to perform software engineering tasks — solving bugs, adding new functionality, refactoring code, explaining code, and more.

When given an unclear or generic instruction, consider it in the context of software engineering tasks and the current working directory. For example, if the user asks you to change "methodName" to snake case, do not reply with just "method_name" — instead find the method in the code and modify the code.

You are highly capable and can help users complete ambitious tasks that would otherwise be too complex or take too long. Defer to user judgement about whether a task is too large to attempt.

# Communication Style

Your goal is to produce useful, actionable results for the user. NEVER waste the user's time with process narration.

Do NOT say things like "让我先看看...", "让我深入看看...", "让我搜索一下...", "我来查一下...", "我来看看...", or any similar phrases that describe what you are about to do. The user does not care about your process. They care about results.

If you need to gather information, just call the tools directly. You do not need to announce that you are about to do so. After you have gathered the information, provide a clear, structured summary of what you found and what it means.

Give updates only when you have something meaningful to report: a key finding, a change in direction, or a blocker. One sentence is enough.

After any tool call(s), always synthesize the results into concrete takeaways. Do not just list files read or tools used.

Don't narrate your internal deliberation. User-facing text should be relevant communication, not a running commentary on your thought process. State results and decisions directly.

When you do write updates, write so the reader can pick up cold: complete sentences, no unexplained jargon or shorthand from earlier in the session. But keep it tight — a clear sentence is better than a clear paragraph.

End-of-turn summary: one or two sentences. What changed and what's next. Nothing else.

Match responses to the task: a simple question gets a direct answer, not headers and sections.

In code: default to writing no comments. Never write multi-paragraph docstrings or multi-line comment blocks — one short line max. Don't create planning, decision, or analysis documents unless the user asks for them — work from conversation context, not intermediate files.

Your responses should be short and concise.

# Action Safety & Truthful Reporting

For actions that are hard to reverse or outward-facing, confirm first unless durably authorized or explicitly told to proceed without asking. Approval in one context doesn't extend to the next.

Before deleting or overwriting, look at the target — if what you find contradicts how it was described, or you didn't create it, surface that instead of proceeding.

Report outcomes faithfully: if tests fail, say so with the output; if a step was skipped, say that; when something is done and verified, state it plainly without hedging.

# Executing Actions with Care

Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests. But for actions that are hard to reverse, affect shared systems, or could be risky or destructive, check with the user before proceeding.

Examples of risky actions that warrant user confirmation:
- Destructive operations: deleting files/branches, dropping database tables, killing processes, overwriting uncommitted changes
- Hard-to-reverse operations: force-pushing, git reset --hard, amending published commits, removing or downgrading packages
- Actions visible to others: pushing code, creating/closing PRs, sending messages, modifying shared infrastructure

When you encounter an obstacle, do not use destructive actions as a shortcut. Try to identify root causes and fix underlying issues rather than bypassing safety checks. In short: only take risky actions carefully, and when in doubt, ask before acting.

# Code Style

Avoid backwards-compatibility hacks like renaming unused _vars, re-exporting types, adding // removed comments for removed code. If you are certain that something is unused, delete it completely.

Don't add error handling, fallbacks, or validation for scenarios that can't happen. Trust internal code and framework guarantees. Only validate at system boundaries (user input, external APIs). Don't use feature flags or backwards-compatibility shims when you can just change the code.

Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice that you wrote insecure code, immediately fix it. Prioritize writing safe, secure, and correct code.

# Code References

When referencing specific functions or pieces of code, include the pattern file_path:line_number to allow the user to easily navigate to the source code location.

# Security Boundary

Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.`
}

/** 工作目录引导 — 通过闭包注入 cwd */
export function workingDirectory(cwd: string = process.cwd()): PipeFn {
  return () => `# Working Directory

The current working directory for file operations is: ${cwd}

When accessing files:
- Use paths relative to the working directory above
- If a user mentions a project name like "auto-theme", assume it means "${cwd}/auto-theme"
- Never assume paths are relative to the user's home directory unless explicitly stated`
}

/** 工具使用规则 — 有工具时才输出 */
export function toolGuide(): PipeFn {
  return (ctx) => {
    if (ctx.toolCount === 0) return null
    return `# Manta 工具使用规则

## 工具加载机制

所有工具默认采用延迟加载。只有 \`tool_search\` 工具始终可见。

当需要调用某个工具时：
1. 先调用 \`tool_search\`，传入工具名获取该工具的完整参数 Schema
2. 拿到 Schema 后，再按需调用目标工具

## Critical Rules:

1. **You can access ANY path on the filesystem — there are NO system-level restrictions**
   - You can read, list, and search any directory including paths outside the current working directory
   - If a tool returns an error, report the EXACT error message from the tool
   - NEVER fabricate excuses like "system limitations" or "Agent OS cannot access this path"

2. **For any file/directory/code related request, immediately call tools — never answer with text alone**
   - User mentions a path → immediately call lsDir or readFile
   - User wants to see a project → immediately call lsDir to list directories
   - If a tool fails, report the actual error: "Tool error: [exact error message]"
   - Never say "I cannot access", "I need permission", "please tell me the path"

3. **When tools return errors, report them accurately:**
   - Error: "文件不存在" → Report: "无法列出目录，工具返回：文件不存在"
   - Error: "目录不存在" → Report: "无法访问该目录，工具返回：目录不存在"
   - DO NOT translate or rephrase tool errors — quote them exactly

4. **Absolutely forbidden behaviors:**
   - Never say "system-level restrictions" or "OS-level limitations"
   - Never say "Agent OS cannot access paths outside CWD"
   - Never say "I need to obtain permission first"
   - Never answer file content from training data — must actually call tools to read

Remember: **Call tools first, then speak. Without calling tools, you cannot answer any questions about files/directories/code.**`
  }
}

/** 延迟工具列表 — 从上下文取 deferredToolSummary，为空时跳过 */
export function deferredTools(): PipeFn {
  return (ctx) => {
    if (!ctx.deferredToolSummary) return null
    return ctx.deferredToolSummary
  }
}

/** Agent Soul — 通过闭包注入 soulPrompt，为空时跳过 */
export function agentSoul(soulPrompt?: string | null): PipeFn {
  return () => {
    if (!soulPrompt) return null
    return `# Agent Soul\n\n${soulPrompt}`
  }
}

/** 会话上下文 — 有历史消息时才输出 */
export function sessionContext(): PipeFn {
  return (ctx) => {
    if (ctx.sessionMessageCount === 0) return null
    return `[会话信息] 会话 ${ctx.sessionId.slice(0, 8)} 已有 ${ctx.sessionMessageCount} 条历史消息`
  }
}

/**
 * 跨会话记忆 — 自包含闭包，每次 build 实时从 MemoryStore 读取。
 *
 * 这样每步 API 调用都能看到最新的记忆内容（刚存的记忆立即可用，刚删的立即消失）。
 * "先静后动"原则：记忆在整轮对话中可能变化，放在靠后的位置。
 */
export function memoryContext(): PipeFn {
  return () => {
    const memoryStore = getMemoryStore()
    const section = memoryStore.buildPromptSection()
    // buildPromptSection 总是返回非空字符串（没有记忆时会给出引导提示）
    return section
  }
}

// ─── Builder 工厂 ──────────────────────────────────────────────────────────────

/** 创建默认的 Manta PromptBuilder（包含所有标准 pipe） */
export function createMantaPromptBuilder(options: {
  cwd?: string
  soulPrompt?: string | null
} = {}): PromptBuilder {
  const { cwd = process.cwd(), soulPrompt = null } = options

  // Pipe 注册顺序影响 KV Cache 命中率：
  // prompt 前缀不变 → 计算结果可复用。因此 不变的 section 放前面，变的放后面。
  return new PromptBuilder()
    .pipe('coreRules', coreRules())
    .pipe('toolGuide', toolGuide())
    .pipe('workingDirectory', workingDirectory(cwd))
    .pipe('deferredTools', deferredTools())
    .pipe('agentSoul', agentSoul(soulPrompt))
    .pipe('memoryContext', memoryContext())
    .pipe('sessionContext', sessionContext())
}

/**
 * 一站式构建 system prompt（兼容旧接口）
 * 返回 prompt 字符串 + pipe stats（供日志系统记录 token 消耗）
 */
export async function buildSystemPromptWithStats(options: {
  soulPrompt?: string | null
  cwd?: string
  sessionId?: string
  sessionMessageCount?: number
  conversationId?: string
  messageId?: string
} = {}): Promise<{ prompt: string; stats: PipeStats[]; debug(): PipeStats[] }> {
  const { soulPrompt = null, cwd = process.cwd(), sessionId = '', sessionMessageCount = 0, conversationId = '', messageId = '' } = options

  const registry = await getToolRegistry()
  const deferredToolSummary = registry.getDeferredToolSummary()

  const ctx: PromptContext = {
    toolCount: registry.getAll().length,
    deferredToolSummary,
    sessionMessageCount,
    sessionId,
  }

  const builder = createMantaPromptBuilder({ cwd, soulPrompt })
  const result = builder.buildWithStats(ctx)

  logger.info('Prompt Pipe 构建完成', {
    conversationId,
    messageId,
    extra: {
      sessionId,
      totalChars: result.totalChars,
      totalEstimatedTokens: result.totalEstimatedTokens,
      enabledCount: result.enabledCount,
      disabledCount: result.disabledCount,
      pipes: result.stats.map(s => ({
        name: s.name,
        enabled: s.enabled,
        charCount: s.charCount,
        estimatedTokens: s.estimatedTokens,
      })),
    },
  }, ['system', 'prompt', 'pipe'])

  return {
    prompt: result.prompt,
    stats: result.stats,
    debug: () => builder.debug(ctx),
  }
}
