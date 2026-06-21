import type { DocumentParser, DocumentMetadata, DocumentChunk } from './types'
import { v4 as uuidv4 } from 'uuid'

/**
 * 文本文档解析器
 * 支持 txt, md, html 等文本格式
 */
export class TextDocumentParser implements DocumentParser {
  supportedTypes = ['text/plain', 'text/markdown', 'text/html']

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    const content = buffer.toString('utf-8')
    const chunks: DocumentChunk[] = []

    // 简单的分段逻辑：按双换行符分割
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim())

    let currentIndex = 0
    for (const paragraph of paragraphs) {
      const startIndex = content.indexOf(paragraph, currentIndex)
      const endIndex = startIndex + paragraph.length

      chunks.push({
        id: uuidv4(),
        documentId: metadata.id,
        content: paragraph.trim(),
        metadata: {
          type: 'paragraph',
          startIndex,
          endIndex,
        },
        startIndex,
        endIndex,
      })

      currentIndex = endIndex
    }

    // 如果没有分段，将整个文档作为一个块
    if (chunks.length === 0) {
      chunks.push({
        id: uuidv4(),
        documentId: metadata.id,
        content: content.trim(),
        metadata: { type: 'full' },
        startIndex: 0,
        endIndex: content.length,
      })
    }

    return chunks
  }
}

/**
 * PDF 文档解析器（占位实现）
 */
export class PDFDocumentParser implements DocumentParser {
  supportedTypes = ['application/pdf']

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    // 实际实现需要使用 pdf-parse 或类似库
    // 这里是占位实现
    console.log(`解析 PDF 文档: ${metadata.name}`)

    return [
      {
        id: uuidv4(),
        documentId: metadata.id,
        content: `[PDF内容占位] ${metadata.name}`,
        metadata: { type: 'pdf' },
        startIndex: 0,
        endIndex: 0,
      },
    ]
  }
}

/**
 * 文档解析器工厂
 */
export class DocumentParserFactory {
  private parsers: DocumentParser[] = []

  constructor() {
    // 注册默认解析器
    this.registerParser(new TextDocumentParser())
    this.registerParser(new PDFDocumentParser())
  }

  registerParser(parser: DocumentParser): void {
    this.parsers.push(parser)
  }

  getParser(mimeType: string): DocumentParser | null {
    return this.parsers.find((p) => p.supportedTypes.includes(mimeType)) || null
  }

  async parseDocument(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    const parser = this.getParser(metadata.type)
    if (!parser) {
      throw new Error(`No parser found for MIME type: ${metadata.type}`)
    }
    return parser.parse(buffer, metadata)
  }
}

/**
 * 创建文档解析器工厂实例
 */
export function createDocumentParserFactory(): DocumentParserFactory {
  return new DocumentParserFactory()
}