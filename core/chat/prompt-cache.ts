/**
 * Prompt Cache — 利用 LLM API 的自动前缀缓存降低 Agent Loop 成本
 *
 * ## 背景
 *
 * Agent Loop 中，每步都向 LLM 发送相同的 system prompt + 前面的大部分历史消息。
 * OpenAI 和 Anthropic 等主流 provider 提供自动前缀缓存（Prompt Caching）：
 * - 当请求的 prompt 前缀与之前请求匹配时，API 从缓存读取已计算好的 KV cache
 * - 跳过重复计算 → 延迟降低 50-80%，缓存命中的 token 费用降低 50%
 *
 * ## 工作原理
 *
 * 1. **自动缓存**（OpenAI）：当 prompt 超过 1024 tokens 时自动启用
 *    缓存命中条件：请求的 prompt 前缀与之前请求完全匹配
 *    - 前缀越长匹配越稳定（比如固定的 system prompt）
 *    - 缓存持续 5-10 分钟（非高峰期可达 1 小时）
 *
 * 2. **手动缓存键**（OpenAI providerOptions.promptCacheKey）：
 *    - 同一会话的所有步骤使用相同的 cache key → 提高命中率
 *    - 不同会话使用不同 cache key → 避免缓存污染
 *
 * 3. **保留策略**：
 *    - 默认：内存缓存（5-10 分钟无活动后移出）
 *    - GPT-5.1：可通过 promptCacheRetention='24h' 延长至 24 小时
 *
 * ## 策略
 *
 * ### 对于 Agent Loop：
 * - 每步发送相同的 system prompt（在最前面）
 * - system prompt 由多个 Pipe 组成，顺序固定
 * - **关键优化**：不变的 Pipe（coreRules）放前面，变化的 Pipe（deferredTools）放后面
 * - 每步新增的消息附加在末尾（不会破坏前缀匹配）
 * - 同一会话使用相同的 cache key（基于 conversationId）
 *
 * ### 对于 Compaction：
 * - 压缩改变了消息列表前缀（摘要消息替代了原始消息）
 * - 压缩后 cache 会失效，需要重新建立
 * - 这是可接受的：压缩本身就是为了节省 token
 * - 压缩后的摘要作为稳定的前缀，后续步骤可以再次命中缓存
 *
 * ## 监控
 *
 * 通过以下指标评估缓存效果：
 * - `cachedPromptTokens`：每步缓存命中的 token 数（来自 API 响应）
 * - `cacheHitRate`：缓存命中 token / 总输入 token
 * - 累计节省的 token 数和费用
 */

import type { LLMConfig } from '@/core/llm/types'
import { logger } from '@/core/log'

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/** Provider 特定的 cache 选项 */
export interface CacheProviderOptions {
  /** OpenAI 兼容的 cache 配置 */
  openai?: {
    /** 手动缓存键（同一会话使用相同 key 提高命中率） */
    promptCacheKey?: string
    /** 扩展缓存保留策略（仅 GPT-5.1 系列） */
    promptCacheRetention?: 'in_memory' | '24h'
  }
}

/** 单步缓存命中统计 */
export interface CacheHitStats {
  /** 缓存命中的 token 数 */
  cachedPromptTokens: number
  /** 总输入 token 数 */
  totalInputTokens: number
  /** 缓存命中率（0-1） */
  hitRate: number
}

/** 累计缓存统计 */
export interface CumulativeCacheStats {
  /** 累计缓存命中 token 数 */
  totalCachedTokens: number
  /** 累计输入 token 数 */
  totalInputTokens: number
  /** 累计缓存命中率 */
  overallHitRate: number
  /** 有缓存命中的步骤数 */
  stepsWithCacheHit: number
  /** 总步骤数 */
  totalSteps: number
}

// ─── Cache Key 生成 ────────────────────────────────────────────────────────────

/**
 * 为会话生成稳定的 cache key。
 *
 * 同一 conversationId 产生相同的 key，确保同一次对话的所有步骤
 * 共享同一个缓存命名空间。
 *
 * 格式：`manta-{conversationId前8位}`
 */
export function generateCacheKey(conversationId?: string): string {
  if (!conversationId) {
    // 没有 conversationId 时用时间戳兜底
    return `manta-${Date.now().toString(36)}`
  }
  // 取前 8 位作为短标识（足够区分不同会话）
  const shortId = conversationId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  return `manta-${shortId}`
}

// ─── Provider Options 构建 ─────────────────────────────────────────────────────

/**
 * 判断当前配置的 provider 是否支持 prompt cache。
 *
 * 目前 OpenAI 和 OpenAI 兼容 API 普遍支持 prompt caching。
 * Ollama / LM Studio 本地模型不支持。
 */
export function supportsPromptCache(config: LLMConfig): boolean {
  if (config.provider === 'ollama' || config.provider === 'lm-studio') {
    return false
  }
  // openai 和 openai-compatible 都支持
  return true
}

/**
 * 构建 providerOptions 以启用 prompt cache。
 *
 * @param config - LLM 配置
 * @param conversationId - 会话 ID（用于生成稳定的 cache key）
 * @returns providerOptions 对象，不支持的 provider 返回空对象
 */
export function buildCacheProviderOptions(
  config: LLMConfig,
  conversationId?: string,
): Record<string, Record<string, string | undefined>> {
  if (!supportsPromptCache(config)) {
    return {}
  }

  const openaiOptions: Record<string, string | undefined> = {}

  // 手动 cache key 提高命中率
  if (conversationId) {
    openaiOptions.promptCacheKey = generateCacheKey(conversationId)
  }

  return { openai: openaiOptions }
}

// ─── Cache 命中率计算 ──────────────────────────────────────────────────────────

/**
 * 从 API 返回的 providerMetadata 中提取缓存命中信息。
 *
 * AI SDK v6 的 usage 对象中已包含 inputTokenDetails，
 * 但 providerMetadata 提供了更详细的缓存信息。
 *
 * @param providerMetadata - 来自 streamText result 的 providerMetadata
 * @returns 缓存命中统计，没有缓存数据时返回 null
 */
export function extractCacheHit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providerMetadata: any,
): CacheHitStats | null {
  const openaiMeta = providerMetadata?.openai
  if (!openaiMeta || typeof openaiMeta.cachedPromptTokens !== 'number') {
    return null
  }

  const cachedPromptTokens = openaiMeta.cachedPromptTokens
  // totalInputTokens 可能在 metadata 中或需要从 usage 获取
  const totalInputTokens = openaiMeta.totalInputTokens ?? 0

  return {
    cachedPromptTokens,
    totalInputTokens,
    hitRate: totalInputTokens > 0 ? cachedPromptTokens / totalInputTokens : 0,
  }
}

// ─── 累计统计 ──────────────────────────────────────────────────────────────────

/**
 * 缓存统计累加器（用于 Agent Loop 中跟踪累计缓存效果）
 */
export class CacheStatsAccumulator {
  private totalCached = 0
  private totalInput = 0
  private stepsWithHit = 0
  private steps = 0

  /** 记录一个步骤的缓存统计 */
  record(cachedTokens: number, inputTokens: number): void {
    this.steps++
    if (cachedTokens > 0) {
      this.stepsWithHit++
    }
    this.totalCached += cachedTokens
    this.totalInput += inputTokens
  }

  /** 获取累计统计 */
  getStats(): CumulativeCacheStats {
    return {
      totalCachedTokens: this.totalCached,
      totalInputTokens: this.totalInput,
      overallHitRate: this.totalInput > 0 ? this.totalCached / this.totalInput : 0,
      stepsWithCacheHit: this.stepsWithHit,
      totalSteps: this.steps,
    }
  }

  /** 重置统计 */
  reset(): void {
    this.totalCached = 0
    this.totalInput = 0
    this.stepsWithHit = 0
    this.steps = 0
  }
}

// ─── Prompt 结构优化建议 ───────────────────────────────────────────────────────

/**
 * Prompt Pipe 排序建议：确保缓存友好的 Pipe 顺序。
 *
 * 核心原则：
 * 1. 不变的放在前面（最大化前缀匹配）
 * 2. 半变化的放在中间
 * 3. 完全动态的放在最后
 *
 * 当前 Pipe 注册顺序已符合此原则：
 * - coreRules: 完全固定（不变）✓
 * - toolGuide: 取决于 toolCount（变化频率低）✓
 * - workingDirectory: 取决于 cwd（会话内不变）✓
 * - deferredTools: 工具列表可能变化（变化频率中）✓
 * - agentSoul: 取决于 soulPrompt（会话内不变）✓
 * - sessionContext: 会话消息数（每步变化）→ 应放在最后 ✓
 *
 * 不需要额外排序。
 */

/**
 * 记录 cache 友好的日志信息。
 * 用于提示用户当前配置是否有利于 prompt cache。
 */
export function logCacheStrategy(
  config: LLMConfig,
  conversationId?: string,
): void {
  if (!supportsPromptCache(config)) {
    logger.info(
      `[PromptCache] Provider ${config.provider} 不支持 prompt caching`,
      { extra: { provider: config.provider, model: config.model } },
      ['agent', 'cache'],
    )
    return
  }

  const cacheKey = generateCacheKey(conversationId)
  logger.info(
    `[PromptCache] 启用 · provider=${config.provider} · model=${config.model} · key=${cacheKey}`,
    {
      conversationId,
      extra: {
        provider: config.provider,
        model: config.model,
        cacheKey,
        strategy: 'auto-prefix-cache',
        retentionPolicy: 'in_memory (5-10min)',
      },
    },
    ['agent', 'cache'],
  )
}

/**
 * 计算 cache 节省的费用（估算）。
 *
 * 缓存命中的 token 费用通常是原价的 50%。
 *
 * @param cachedTokens - 缓存命中的 token 数
 * @param pricePerMillionTokens - 每百万 token 的价格（美元）
 * @returns 节省的费用（美元）
 */
export function estimateCacheSavings(
  cachedTokens: number,
  pricePerMillionTokens: number,
): number {
  const fullPrice = (cachedTokens / 1_000_000) * pricePerMillionTokens
  // 缓存命中节省 50%
  return fullPrice * 0.5
}

/**
 * 获取常见模型的输入 token 价格（美元/百万 token）。
 * 用于费用估算。
 */
export function getModelInputPrice(model: string): number {
  const lower = model.toLowerCase()
  if (lower.includes('gpt-4o')) return 2.50
  if (lower.includes('gpt-4')) return 30.00
  if (lower.includes('gpt-3.5')) return 0.50
  if (lower.includes('claude-3.5')) return 3.00
  if (lower.includes('claude-3')) return 3.00
  if (lower.includes('deepseek')) return 0.27
  // 默认价格
  return 2.50
}
