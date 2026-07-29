import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveApplicationEditorMode } from './ReadonlyCodeEditor'

const editorSource = readFileSync(new URL('./ReadonlyCodeEditor.tsx', import.meta.url), 'utf8')
const reviewSource = readFileSync(new URL('./ReviewTab.tsx', import.meta.url), 'utf8')
const filesSource = readFileSync(new URL('./FilesTab.tsx', import.meta.url), 'utf8')

describe('ReadonlyCodeEditor', () => {
  it('uses a locally bundled Monaco editor and disables code editing', () => {
    expect(editorSource).toContain("from '@monaco-editor/react'")
    expect(editorSource).toContain('<DiffEditor')
    expect(editorSource).toContain("import('monaco-editor/esm/vs/editor/editor.api')")
    expect(editorSource).toContain('loader.config({ monaco:')
    expect(editorSource).toContain('readOnly: true')
    expect(editorSource).toContain('domReadOnly: true')
    expect(editorSource).not.toContain('cdn.jsdelivr')
  })

  it('follows Manta theme classes and custom color variables', () => {
    expect(resolveApplicationEditorMode('dark', false)).toBe('dark')
    expect(resolveApplicationEditorMode('light', true)).toBe('light')
    expect(resolveApplicationEditorMode('', true)).toBe('dark')
    expect(editorSource).toContain('new MutationObserver(updateTheme)')
    expect(editorSource).toContain("attributeFilter: ['class', 'style']")
    expect(editorSource).toContain("rootColor('--color-background'")
    expect(editorSource).toContain("rootColor('--color-status-done'")
    expect(editorSource).toContain("token: 'inserted'")
    expect(editorSource).toContain("token: 'deleted'")
    expect(editorSource).toContain('monaco.editor.defineTheme(themeName')
    expect(editorSource).toContain('monaco.editor.setTheme(themeName)')
  })

  it('backs both review diffs and file previews with the shared editor', () => {
    expect(reviewSource).toContain('<ReadonlyCodeEditor')
    expect(reviewSource).toContain('<ReadonlyDiffEditor')
    expect(reviewSource).toContain('language="diff"')
    expect(reviewSource).toContain("setDiffMode('unified')")
    expect(reviewSource).toContain("setDiffMode('split')")
    expect(reviewSource).toContain("useState<'unified' | 'split'>('split')")
    expect(reviewSource).not.toContain('<span>统一</span>')
    expect(reviewSource).not.toContain('<span>拆分</span>')
    expect(reviewSource).toContain('setFilesVisible')
    expect(reviewSource).toContain("runReviewAction('commit-push')")
    expect(filesSource).toContain('<ReadonlyCodeEditor')
    expect(filesSource).toContain('path={preview.path}')
    expect(reviewSource).not.toContain('<pre className="workspace-review-diff"')
    expect(filesSource).not.toContain('<pre className="file-preview-code"')
  })
})
