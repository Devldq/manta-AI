import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const editorSource = readFileSync(new URL('./ReadonlyCodeEditor.tsx', import.meta.url), 'utf8')
const reviewSource = readFileSync(new URL('./ReviewTab.tsx', import.meta.url), 'utf8')
const filesSource = readFileSync(new URL('./FilesTab.tsx', import.meta.url), 'utf8')

describe('ReadonlyCodeEditor', () => {
  it('uses a locally bundled Monaco editor and disables code editing', () => {
    expect(editorSource).toContain("from '@monaco-editor/react'")
    expect(editorSource).toContain("import('monaco-editor/esm/vs/editor/editor.api')")
    expect(editorSource).toContain('loader.config({ monaco:')
    expect(editorSource).toContain('readOnly: true')
    expect(editorSource).toContain('domReadOnly: true')
    expect(editorSource).not.toContain('cdn.jsdelivr')
  })

  it('follows the operating-system color scheme', () => {
    expect(editorSource).toContain("matchMedia?.('(prefers-color-scheme: dark)')")
    expect(editorSource).toContain("media.addEventListener('change', updateTheme)")
    expect(editorSource).toContain("'vs-dark'")
    expect(editorSource).toContain("'vs'")
  })

  it('backs both review diffs and file previews with the shared editor', () => {
    expect(reviewSource).toContain('<ReadonlyCodeEditor')
    expect(reviewSource).toContain('language="diff"')
    expect(filesSource).toContain('<ReadonlyCodeEditor')
    expect(filesSource).toContain('path={preview.path}')
    expect(reviewSource).not.toContain('<pre className="workspace-review-diff"')
    expect(filesSource).not.toContain('<pre className="file-preview-code"')
  })
})
