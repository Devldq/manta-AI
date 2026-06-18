import type { ChunkingStrategy, ChunkingOptions } from './types'

/**
 * 固定大小分块策略
 * 将文本按固定字符数分割，支持重叠
 */
export class FixedSizeChunkingStrategy implements ChunkingStrategy {
  private defaultOptions: Required<ChunkingOptions> = {
    chunkSize: 1000,
    overlap: 200,
    separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' '],
  }

  chunk(text: string, options?: ChunkingOptions): string[] {
    const opts = { ...this.defaultOptions, ...options }
    const chunks: string[] = []

    if (text.length <= opts.chunkSize) {
      return [text]
    }

    let startIndex = 0
    while (startIndex < text.length) {
      let endIndex = startIndex + opts.chunkSize

      // 如果不是最后一块，尝试在分隔符处断开
      if (endIndex < text.length) {
        endIndex = this.findBestBreakPoint(text, startIndex, endIndex, opts.separators)
      }

      const chunk = text.slice(startIndex, endIndex).trim()
      if (chunk) {
        chunks.push(chunk)
      }

      // 移动到下一个位置，考虑重叠
      startIndex = endIndex - opts.overlap
      if (startIndex >= text.length) break
    }

    return chunks
  }

  private findBestBreakPoint(
    text: string,
    startIndex: number,
    endIndex: number,
    separators: string[]
  ): number {
    // 按优先级尝试分隔符
    for (const separator of separators) {
      const lastSeparatorIndex = text.lastIndexOf(separator, endIndex)
      if (lastSeparatorIndex > startIndex) {
        return lastSeparatorIndex + separator.length
      }
    }

    // 如果没有找到分隔符，就在空格处断开
    const lastSpaceIndex = text.lastIndexOf(' ', endIndex)
    if (lastSpaceIndex > startIndex) {
      return lastSpaceIndex + 1
    }

    // 如果都没有，强制在endIndex处断开
    return endIndex
  }
}

/**
 * 语义分块策略（占位实现）
 * 基于语义边界分割文本
 */
export class SemanticChunkingStrategy implements ChunkingStrategy {
  chunk(text: string, options?: ChunkingOptions): string[] {
    // 实际实现需要使用 NLP 库来识别语义边界
    // 这里使用简单的段落分割作为占位
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim())
    const chunks: string[] = []

    const chunkSize = options?.chunkSize || 1000
    let currentChunk = ''

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length > chunkSize && currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = ''
      }
      currentChunk += paragraph + '\n\n'
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }

    return chunks.length > 0 ? chunks : [text]
  }
}

/**
 * 递归分块策略
 * 递归地使用不同分隔符分割文本
 */
export class RecursiveChunkingStrategy implements ChunkingStrategy {
  private defaultOptions: Required<ChunkingOptions> = {
    chunkSize: 1000,
    overlap: 200,
    separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', '；', ';', '，', ',', ' '],
  }

  chunk(text: string, options?: ChunkingOptions): string[] {
    const opts = { ...this.defaultOptions, ...options }
    return this.recursiveSplit(text, opts.separators, opts)
  }

  private recursiveSplit(
    text: string,
    separators: string[],
    options: Required<ChunkingOptions>
  ): string[] {
    if (text.length <= options.chunkSize) {
      return [text]
    }

    const separator = separators[0]
    const remainingSeparators = separators.slice(1)

    if (!separator) {
      // 没有更多分隔符，强制分割
      return this.forceSplit(text, options)
    }

    const parts = text.split(separator)
    const chunks: string[] = []
    let currentChunk = ''

    for (const part of parts) {
      if (currentChunk.length + part.length > options.chunkSize && currentChunk) {
        chunks.push(currentChunk.trim())
        currentChunk = ''
      }
      currentChunk += part + separator
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }

    // 如果分块太大，递归使用下一个分隔符
    return chunks.flatMap((chunk) =>
      chunk.length > options.chunkSize
        ? this.recursiveSplit(chunk, remainingSeparators, options)
        : [chunk]
    )
  }

  private forceSplit(text: string, options: Required<ChunkingOptions>): string[] {
    const chunks: string[] = []
    let startIndex = 0

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + options.chunkSize, text.length)
      chunks.push(text.slice(startIndex, endIndex))
      startIndex = endIndex - options.overlap
    }

    return chunks
  }
}

/**
 * 分块策略工厂
 */
export class ChunkingStrategyFactory {
  static create(strategy: 'fixed' | 'semantic' | 'recursive' = 'fixed'): ChunkingStrategy {
    switch (strategy) {
      case 'fixed':
        return new FixedSizeChunkingStrategy()
      case 'semantic':
        return new SemanticChunkingStrategy()
      case 'recursive':
        return new RecursiveChunkingStrategy()
      default:
        throw new Error(`Unknown chunking strategy: ${strategy}`)
    }
  }
}