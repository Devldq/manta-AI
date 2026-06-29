import type { DocumentParser, DocumentMetadata, DocumentChunk } from './types'
import { v4 as uuidv4 } from 'uuid'

// ─── MIME type 常量 ──────────────────────────────────────────
export const SUPPORTED_MIME_TYPES = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  DOC: 'application/msword',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XLS: 'application/vnd.ms-excel',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  PPT: 'application/vnd.ms-powerpoint',
  TXT: 'text/plain',
  MD: 'text/markdown',
  CSV: 'text/csv',
} as const

// ─── 辅助函数 ────────────────────────────────────────────────

/** 将文本按段落拆分为 chunks，记录 startIndex/endIndex */
function textToChunks(documentId: string, content: string, metaType: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim())

  let currentIndex = 0
  for (const paragraph of paragraphs) {
    const startIndex = content.indexOf(paragraph, currentIndex)
    const endIndex = startIndex + paragraph.length

    chunks.push({
      id: uuidv4(),
      documentId,
      content: paragraph.trim(),
      metadata: { type: metaType, startIndex, endIndex },
      startIndex,
      endIndex,
    })
    currentIndex = endIndex
  }

  // 如果无分段，整个文档作为一个 chunk
  if (chunks.length === 0 && content.trim()) {
    chunks.push({
      id: uuidv4(),
      documentId,
      content: content.trim(),
      metadata: { type: 'full' },
      startIndex: 0,
      endIndex: content.length,
    })
  }

  return chunks
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// ─── 纯文本解析器 (TXT, MD, CSV) ─────────────────────────────

export class TextDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.TXT, SUPPORTED_MIME_TYPES.MD, SUPPORTED_MIME_TYPES.CSV]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    const content = buffer.toString('utf-8')
    return textToChunks(metadata.id, content, 'text')
  }
}

// ─── PDF 解析器 ──────────────────────────────────────────────

export class PDFDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.PDF]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    try {
      // 动态导入 pdf-parse
      const pdfParse = (await import('pdf-parse') as any).default || (await import('pdf-parse') as any)
      const data = await pdfParse(buffer)

      const content = data.text
      if (!content || !content.trim()) {
        throw new Error('PDF 文件未提取到文本内容，可能是扫描件或图片型 PDF')
      }

      const chunks = textToChunks(metadata.id, content, 'pdf')
      // 附加 PDF 元数据
      const headerInfo = `[文档: ${metadata.name}]
[页数: ${data.numpages}]
[PDF信息: ${data.info?.Title || '无标题'}, 作者: ${data.info?.Author || '未知'}]
---
`
      // 在第一个 chunk 前插入文档头信息
      if (chunks.length > 0) {
        chunks[0] = {
          ...chunks[0],
          content: headerInfo + chunks[0].content,
        }
      }

      return chunks
    } catch (error) {
      throw new Error(
        `PDF 解析失败 (${metadata.name}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

// ─── DOCX 解析器 ─────────────────────────────────────────────

export class DocxDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.DOCX]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    try {
      const mammoth = (await import('mammoth')).default
      const result = await mammoth.extractRawText({ buffer })

      if (!result.value || !result.value.trim()) {
        throw new Error('DOCX 文件未提取到文本内容')
      }

      // 收集警告信息
      const warnings = result.messages
        .filter((m: { type: string }) => m.type === 'warning')
        .map((m: { message: string }) => m.message)

      const content = result.value
      const chunks = textToChunks(metadata.id, content, 'docx')

      if (warnings.length > 0) {
        chunks[0] = {
          ...chunks[0],
          content: `[解析警告: ${warnings.join('; ')}]\n---\n${chunks[0].content}`,
        }
      }

      return chunks
    } catch (error) {
      throw new Error(
        `DOCX 解析失败 (${metadata.name}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

// ─── DOC 解析器（旧格式，需要 LibreOffice） ──────────────────

export class DocDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.DOC]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    // .doc 是旧的二进制格式，Node.js 原生无法直接解析
    // 推荐方案：使用 LibreOffice headless 模式转换
    // 这里提供清晰的错误提示和替代方案
    throw new Error(
      `.doc 格式（旧版 Word）需要系统安装 LibreOffice 才能解析。\n` +
      `请安装: brew install libreoffice (macOS) 或 apt install libreoffice (Linux)\n` +
      `或将文件另存为 .docx 格式后重新上传。\n` +
      `文件: ${metadata.name} (${formatSize(metadata.size)})`
    )
  }
}

// ─── XLSX 解析器 ─────────────────────────────────────────────

export class XlsxDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.XLSX, SUPPORTED_MIME_TYPES.XLS]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(buffer, { type: 'buffer' })

      const sheetTexts: string[] = []
      const sheetNames = workbook.SheetNames

      for (const name of sheetNames) {
        const sheet = workbook.Sheets[name]
        // 使用 CSV 格式导出每个 sheet 的内容
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, strip: true })
        if (csv.trim()) {
          sheetTexts.push(`【Sheet: ${name}】\n${csv}`)
        }
      }

      const content = sheetTexts.join('\n\n')
      if (!content.trim()) {
        throw new Error('Excel 文件未提取到数据')
      }

      const chunks = textToChunks(metadata.id, content, 'xlsx')

      // 附加表格元数据
      const totalRows = sheetNames.reduce((sum, name) => {
        const sheet = workbook.Sheets[name]
        const ref = sheet['!ref']
        return sum + (ref ? ((ref as any).e.r - (ref as any).s.r + 1) : 0)
      }, 0)

      chunks[0] = {
        ...chunks[0],
        content: `[文档: ${metadata.name}]
[工作表数: ${sheetNames.length} (${sheetNames.join(', ')})]
[总行数: ${totalRows}]
---
${chunks[0].content}`,
      }

      return chunks
    } catch (error) {
      throw new Error(
        `Excel 解析失败 (${metadata.name}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

// ─── PPTX 解析器 ─────────────────────────────────────────────

export class PptxDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.PPTX]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    try {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buffer)

      // PPTX 是 ZIP 文件，幻灯片内容在 ppt/slides/slide*.xml
      const slideFiles: string[] = []
      const slideDir = zip.folder('ppt/slides')

      if (!slideDir) {
        throw new Error('无法找到 PPTX 幻灯片内容')
      }

      slideDir.forEach((relativePath, file) => {
        if (relativePath.startsWith('slide') && relativePath.endsWith('.xml') && !file.dir) {
          slideFiles.push(relativePath)
        }
      })

      // 按幻灯片编号排序
      slideFiles.sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0', 10)
        const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0', 10)
        return numA - numB
      })

      const slideTexts: string[] = []
      for (let i = 0; i < slideFiles.length; i++) {
        const file = slideFiles[i]
        const xmlContent = await zip.file(`ppt/slides/${file}`)?.async('string')
        if (!xmlContent) continue

        // 提取 <a:t> 标签内的文本（PPTX 文本元素）
        const textMatches = xmlContent.match(/<a:t[^>]*>([^<]*)<\/a:t>/g)
        if (textMatches) {
          const texts = textMatches
            .map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, '').trim())
            .filter((t: string) => t.length > 0)

          if (texts.length > 0) {
            slideTexts.push(`【幻灯片 ${i + 1}】\n${texts.join('\n')}`)
          }
        }
      }

      // 同时提取备注内容
      const notesDir = zip.folder('ppt/notesSlides')
      if (notesDir) {
        notesDir.forEach((relativePath, file) => {
          if (relativePath.endsWith('.xml') && !file.dir) {
            // 备注在 notesSlide*.xml 中
          }
        })
      }

      const content = slideTexts.join('\n\n')
      if (!content.trim()) {
        throw new Error('PPTX 文件未提取到文本内容，幻灯片可能仅包含图片')
      }

      const chunks = textToChunks(metadata.id, content, 'pptx')

      chunks[0] = {
        ...chunks[0],
        content: `[文档: ${metadata.name}]
[幻灯片数: ${slideFiles.length}]
---
${chunks[0].content}`,
      }

      return chunks
    } catch (error) {
      throw new Error(
        `PPTX 解析失败 (${metadata.name}): ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

// ─── PPT 解析器（旧格式，需要 LibreOffice） ──────────────────

export class PptDocumentParser implements DocumentParser {
  supportedTypes = [SUPPORTED_MIME_TYPES.PPT]

  async parse(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    // .ppt 是旧的二进制格式，Node.js 原生无法直接解析
    throw new Error(
      `.ppt 格式（旧版 PowerPoint）需要系统安装 LibreOffice 才能解析。\n` +
      `请安装: brew install libreoffice (macOS) 或 apt install libreoffice (Linux)\n` +
      `或将文件另存为 .pptx 格式后重新上传。\n` +
      `文件: ${metadata.name} (${formatSize(metadata.size)})`
    )
  }
}

// ─── 文档解析器工厂 ──────────────────────────────────────────

export class DocumentParserFactory {
  private parsers: DocumentParser[] = []

  constructor() {
    // 按优先级注册解析器
    this.registerParser(new TextDocumentParser())
    this.registerParser(new PDFDocumentParser())
    this.registerParser(new DocxDocumentParser())
    this.registerParser(new DocDocumentParser())
    this.registerParser(new XlsxDocumentParser())
    this.registerParser(new PptxDocumentParser())
    this.registerParser(new PptDocumentParser())
  }

  registerParser(parser: DocumentParser): void {
    this.parsers.push(parser)
  }

  getParser(mimeType: string): DocumentParser | null {
    return this.parsers.find((p) => p.supportedTypes.includes(mimeType)) || null
  }

  getSupportedMimeTypes(): { mimeType: string; label: string }[] {
    const supported: { mimeType: string; label: string }[] = []
    const seen = new Set<string>()
    for (const parser of this.parsers) {
      for (const mime of parser.supportedTypes) {
        if (!seen.has(mime)) {
          seen.add(mime)
          supported.push({ mimeType: mime, label: mimeLabel(mime) })
        }
      }
    }
    return supported
  }

  async parseDocument(buffer: Buffer, metadata: DocumentMetadata): Promise<DocumentChunk[]> {
    const parser = this.getParser(metadata.type)
    if (!parser) {
      throw new Error(
        `不支持的文件格式: ${metadata.type}\n` +
        `文件: ${metadata.name}\n` +
        `支持的格式: ${this.getSupportedMimeTypes().map((m) => m.label).join(', ')}`
      )
    }
    return parser.parse(buffer, metadata)
  }
}

// ─── MIME 类型标签映射 ───────────────────────────────────────

function mimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    [SUPPORTED_MIME_TYPES.PDF]: 'PDF',
    [SUPPORTED_MIME_TYPES.DOCX]: 'DOCX',
    [SUPPORTED_MIME_TYPES.DOC]: 'DOC (需LibreOffice)',
    [SUPPORTED_MIME_TYPES.XLSX]: 'XLSX',
    [SUPPORTED_MIME_TYPES.XLS]: 'XLS',
    [SUPPORTED_MIME_TYPES.PPTX]: 'PPTX',
    [SUPPORTED_MIME_TYPES.PPT]: 'PPT (需LibreOffice)',
    [SUPPORTED_MIME_TYPES.TXT]: 'TXT',
    [SUPPORTED_MIME_TYPES.MD]: 'MD',
    [SUPPORTED_MIME_TYPES.CSV]: 'CSV',
  }
  return map[mimeType] || mimeType
}

// ─── 工厂函数 ────────────────────────────────────────────────

let factoryInstance: DocumentParserFactory | null = null

export function createDocumentParserFactory(): DocumentParserFactory {
  if (!factoryInstance) {
    factoryInstance = new DocumentParserFactory()
  }
  return factoryInstance
}

/**
 * 根据文件扩展名推断 MIME 类型
 */
export function inferMimeType(filename: string): string {
  const ext = (filename.split('.').pop() || '').toLowerCase()
  const extMap: Record<string, string> = {
    pdf: SUPPORTED_MIME_TYPES.PDF,
    docx: SUPPORTED_MIME_TYPES.DOCX,
    doc: SUPPORTED_MIME_TYPES.DOC,
    xlsx: SUPPORTED_MIME_TYPES.XLSX,
    xls: SUPPORTED_MIME_TYPES.XLS,
    pptx: SUPPORTED_MIME_TYPES.PPTX,
    ppt: SUPPORTED_MIME_TYPES.PPT,
    txt: SUPPORTED_MIME_TYPES.TXT,
    md: SUPPORTED_MIME_TYPES.MD,
    csv: SUPPORTED_MIME_TYPES.CSV,
  }
  return extMap[ext] || 'application/octet-stream'
}
