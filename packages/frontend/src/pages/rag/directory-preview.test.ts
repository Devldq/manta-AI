import { describe, expect, it } from 'vitest'
import { getKnowledgeBaseDirectoryPreview } from './directory-preview'

describe('knowledge base directory preview', () => {
  it('returns an empty preview for a knowledge base without documents', () => {
    expect(getKnowledgeBaseDirectoryPreview([])).toEqual({ visible: [], remaining: 0 })
  })

  it('shows the first three filenames and the remaining count', () => {
    expect(getKnowledgeBaseDirectoryPreview(['一.md', '二.pdf', '三.xlsx', '四.txt'])).toEqual({
      visible: ['一.md', '二.pdf', '三.xlsx'],
      remaining: 1,
    })
  })

  it('preserves duplicate filenames and upload order', () => {
    expect(getKnowledgeBaseDirectoryPreview(['方案.pdf', '方案.pdf', '预算.xlsx'])).toEqual({
      visible: ['方案.pdf', '方案.pdf', '预算.xlsx'],
      remaining: 0,
    })
  })
})
