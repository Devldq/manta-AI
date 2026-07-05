/**
 * RAG 问答 — 检索增强生成的上下文构建
 *
 * 负责：将检索结果格式化为 LLM prompt 中的上下文片段，
 * 不负责调用 LLM（由调用方通过 streamText 等实现）。
 *
 * 支持：引用标注（[来源 N]）、拒答机制（无相关内容时诚实告知）。
 */

import type { RetrievalResult } from './types'

export interface ChatContextChunk {
  content: string
  /** 来源文件名 */
  sourceName: string
  /** 文档 ID */
  documentId: string
  /** 相关度评分 (0-1) */
  score: number
  /** chunk 在文档中的位置序号 */
  index?: number
  /** 估算 token 数 */
  tokenEstimate?: number
  /** chunk 原文起始位置 */
  startIndex?: number
  /** chunk 原文结束位置 */
  endIndex?: number
}

export interface ChatContext {
  /** 检索到的上下文片段 */
  chunks: ChatContextChunk[]
}

/**
 * 从 RetrievalResult[] 提取问答上下文（含 chunk 元数据）
 */
export function extractChatContext(results: RetrievalResult[]): ChatContext {
  const chunks: ChatContextChunk[] = results.map((r) => ({
    content: r.chunk.content,
    sourceName:
      (r.chunk.metadata?.source as string) ||
      (r.metadata.documentName as string) ||
      r.chunk.documentId.slice(0, 8),
    documentId: r.chunk.documentId,
    score: r.score,
    index: r.chunk.metadata?.index as number | undefined,
    tokenEstimate: r.chunk.metadata?.tokenEstimate as number | undefined,
    startIndex: r.chunk.startIndex,
    endIndex: r.chunk.endIndex,
  }))

  return { chunks }
}

/**
 * 构建 RAG 问答的 system prompt
 *
 * 将检索到的文档片段注入 prompt，指示 LLM：
 * 1. 严格基于检索内容回答
 * 2. 引用来源（[来源 N] 格式）
 * 3. 检索结果不足时拒答
 */
export function buildRAGSystemPrompt(context: ChatContext): string {
  if (context.chunks.length === 0) {
    return `你是知识库问答助手。

## 当前状态
知识库中没有找到与用户问题相关的文档内容。

## 回答要求
请直接告知用户：
- 「抱歉，我在知识库中未找到与您问题相关的内容。」
- 不要编造答案，不要使用外部知识。
- 建议用户上传相关文档或尝试换个问题。`
  }

  const contextText = context.chunks
    .map((c, i) => {
      const idx = c.index != null ? `#${c.index}` : ''
      const tok = c.tokenEstimate ? ` (${c.tokenEstimate} tok)` : ''
      const score = Math.round(c.score * 100)
      return `[来源 ${i + 1}: ${c.sourceName}${idx}]${tok} 相关度: ${score}%\n${c.content}`
    })
    .join('\n\n---\n\n')

  return `你是知识库问答助手。请严格基于以下检索到的文档内容回答用户问题。

## 知识库检索结果

${contextText}

## 回答规则

1. **基于内容回答**：只使用上述检索结果中的信息回答问题，不要编造或使用外部知识。
2. **引用来源**：回答中每条信息末尾标注来源，格式为「[来源 N]」。多个来源用「[来源 1, 2]」格式。示例：
   - 正确：「根据文档内容，该系统支持自动分块功能 [来源 1]」
   - 错误：「该系统支持自动分块功能」（缺少引用）
3. **拒答机制**：如果检索结果不足以回答问题，或问题与检索内容不相关，请明确告知：
   - 「抱歉，知识库中的现有内容不足以回答这个问题。以下是我找到的相关信息：...」
   - 然后可以简要列出找到的部分相关内容，并标注来源。
   - 不要猜测或编造未在检索结果中出现的信息。
4. **结构清晰**：用简洁的中文回答，适当使用标题、列表等结构化格式。
5. **保持友好**：语气自然友好。`
}

/**
 * 构建用户消息（包含问题）
 */
export function buildRAGUserMessage(question: string, context: ChatContext): string {
  if (context.chunks.length === 0) {
    return `问题：${question}\n\n（没有找到相关文档）请告知用户未找到相关内容。`
  }
  return `问题：${question}\n\n请基于上述知识库内容回答，并在回答中标注信息来源。`
}
