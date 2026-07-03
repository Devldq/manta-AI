/**
 * RAG 问答 — 检索增强生成的上下文构建
 *
 * 负责：将检索结果格式化为 LLM prompt 中的上下文片段，
 * 不负责调用 LLM（由调用方通过 streamText 等实现）。
 */

import type { RetrievalResult } from './types'

export interface ChatContext {
  /** 检索到的上下文片段 */
  chunks: Array<{
    content: string
    sourceName: string
    documentId: string
    score: number
  }>
}

/**
 * 从 RetrievalResult[] 提取问答上下文
 */
export function extractChatContext(results: RetrievalResult[]): ChatContext {
  const chunks = results.map((r) => ({
    content: r.chunk.content,
    sourceName: (r.metadata.documentName as string) || r.chunk.documentId.slice(0, 8),
    documentId: r.chunk.documentId,
    score: r.score,
  }))

  return { chunks }
}

/**
 * 构建 RAG 问答的 system prompt
 *
 * 将检索到的文档片段注入 prompt，指示 LLM 基于检索内容回答。
 */
export function buildRAGSystemPrompt(context: ChatContext): string {
  if (context.chunks.length === 0) {
    return `你是知识库助手。当前知识库中没有找到与问题相关的文档。
请诚实告知用户未找到相关信息，并建议用户上传相关文档或换个问题。`
  }

  const contextText = context.chunks
    .map((c, i) => `[来源 ${i + 1}: ${c.sourceName}] (相关度: ${Math.round(c.score * 100)}%)\n${c.content}`)
    .join('\n\n---\n\n')

  return `你是知识库问答助手。请严格基于以下检索到的文档内容回答用户问题。

## 知识库检索结果

${contextText}

## 回答规则

1. **基于内容回答**：只使用上述检索结果中的信息回答问题，不要编造或使用外部知识。
2. **引用来源**：回答时标注信息来源，如「[来源 1]」。
3. **承认不足**：如果检索结果不足以回答问题，请诚实说明，不要猜测。
4. **简洁清晰**：用简洁的中文回答，结构清晰。
5. **保持友好**：语气自然友好。`
}

/**
 * 构建用户消息（包含问题）
 */
export function buildRAGUserMessage(question: string, context: ChatContext): string {
  if (context.chunks.length === 0) {
    return `问题：${question}\n\n（没有找到相关文档）请告知用户。`
  }
  return `问题：${question}\n\n请基于上述知识库内容回答。`
}
