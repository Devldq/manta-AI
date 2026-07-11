import { describe, expect, it } from 'vitest'
import { inferMimeType } from './document-parser'

describe('document MIME inference', () => {
  it('recognizes Markdown notes', () => {
    expect(inferMimeType('notes.md')).toBe('text/markdown')
  })
})
