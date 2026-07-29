import { useEffect, useState } from 'react'
import Editor, { DiffEditor, loader, type Monaco } from '@monaco-editor/react'

const DIFF_LANGUAGE = 'manta-unified-diff'
type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api')
type EditorColorMode = 'light' | 'dark'

let localMonacoSetup: Promise<MonacoApi> | null = null

function setupLocalMonaco() {
  if (localMonacoSetup) return localMonacoSetup
  localMonacoSetup = (async () => {
    const [monaco, { default: EditorWorker }] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.api'),
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'),
      import('monaco-editor/esm/vs/basic-languages/css/css.contribution'),
      import('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution'),
      import('monaco-editor/esm/vs/basic-languages/go/go.contribution'),
      import('monaco-editor/esm/vs/basic-languages/html/html.contribution'),
      import('monaco-editor/esm/vs/basic-languages/java/java.contribution'),
      import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'),
      import('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'),
      import('monaco-editor/esm/vs/basic-languages/python/python.contribution'),
      import('monaco-editor/esm/vs/basic-languages/rust/rust.contribution'),
      import('monaco-editor/esm/vs/basic-languages/shell/shell.contribution'),
      import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution'),
      import('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'),
      import('monaco-editor/esm/vs/basic-languages/xml/xml.contribution'),
      import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'),
    ])

    loader.config({ monaco: monaco as unknown as Monaco })
    const editorGlobal = globalThis as typeof globalThis & {
      MonacoEnvironment?: { getWorker: () => Worker }
    }
    editorGlobal.MonacoEnvironment = {
      getWorker: () => new EditorWorker(),
    }

    if (!monaco.languages.getLanguages().some(({ id }) => id === DIFF_LANGUAGE)) {
      monaco.languages.register({ id: DIFF_LANGUAGE })
      monaco.languages.setMonarchTokensProvider(DIFF_LANGUAGE, {
        tokenizer: {
          root: [
            [/^diff --git.*$/, 'keyword'],
            [/^(?:index|---|\+\+\+).*$/, 'meta'],
            [/^@@.*@@.*$/, 'number'],
            [/^\+(?!\+\+\+).*$/, 'inserted'],
            [/^-(?!---).*$/, 'deleted'],
          ],
        },
      })
    }
    return monaco
  })()
  return localMonacoSetup
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  go: 'go',
  h: 'cpp',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'shell',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

function languageForPath(path?: string) {
  if (!path) return 'plaintext'
  const filename = path.split('/').pop()?.toLowerCase() || ''
  if (filename === 'dockerfile') return 'dockerfile'
  if (/^(?:makefile|gnumakefile)$/.test(filename)) return 'shell'
  const extension = filename.includes('.') ? filename.split('.').pop() || '' : ''
  return LANGUAGE_BY_EXTENSION[extension] || 'plaintext'
}

export function resolveApplicationEditorMode(className: string, systemDark = false): EditorColorMode {
  const classes = new Set(className.split(/\s+/).filter(Boolean))
  if (classes.has('dark')) return 'dark'
  if (classes.has('light')) return 'light'
  return systemDark ? 'dark' : 'light'
}

function readApplicationEditorMode(): EditorColorMode {
  if (typeof document === 'undefined') return 'light'
  return resolveApplicationEditorMode(
    document.documentElement.className,
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  )
}

function useApplicationEditorTheme() {
  const [snapshot, setSnapshot] = useState(() => ({ mode: readApplicationEditorMode(), revision: 0 }))

  useEffect(() => {
    const root = document.documentElement
    const updateTheme = () => {
      const mode = readApplicationEditorMode()
      setSnapshot((current) => ({ mode, revision: current.revision + 1 }))
    }
    const observer = new MutationObserver(updateTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
    updateTheme()
    return () => observer.disconnect()
  }, [])

  return snapshot
}

function rootColor(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return /^#[\da-f]{6}$/i.test(value) ? value : fallback
}

function withAlpha(color: string, alpha: string, fallback: string) {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : fallback
}

function tokenColor(color: string) {
  return color.replace(/^#/, '')
}

function applyApplicationEditorTheme(monaco: MonacoApi, mode: EditorColorMode) {
  const dark = mode === 'dark'
  const background = rootColor('--color-background', dark ? '#0a0a14' : '#f8f6f0')
  const surface = rootColor('--color-surface-elevated', dark ? '#1e1e2e' : '#ffffff')
  const foreground = rootColor('--color-text-primary', dark ? '#e8e8e8' : '#1a1a1a')
  const secondary = rootColor('--color-text-secondary', dark ? '#a0a0a0' : '#5a5a5a')
  const muted = rootColor('--color-text-muted', dark ? '#707070' : '#8a8a8a')
  const border = rootColor('--color-border', dark ? '#2a2a3a' : '#e0ddd5')
  const borderSubtle = rootColor('--color-border-subtle', dark ? '#1a1a2a' : '#ece9e1')
  const accent = rootColor('--color-accent', dark ? '#5ed68a' : '#2d8a4e')
  const added = rootColor('--color-status-done', dark ? '#5ed68a' : '#22863a')
  const deleted = rootColor('--color-status-failed', dark ? '#ff7b9c' : '#cf222e')
  const themeName = `manta-${mode}`

  monaco.editor.defineTheme(themeName, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'inserted', foreground: tokenColor(added) },
      { token: 'deleted', foreground: tokenColor(deleted) },
      { token: 'number', foreground: tokenColor(added), fontStyle: 'bold' },
      { token: 'keyword', foreground: tokenColor(accent) },
      { token: 'meta', foreground: tokenColor(secondary) },
    ],
    colors: {
      'editor.background': background,
      'editor.foreground': foreground,
      'editorGutter.background': background,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': secondary,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': withAlpha(accent, '40', dark ? '#5ed68a40' : '#2d8a4e40'),
      'editor.inactiveSelectionBackground': withAlpha(accent, '24', dark ? '#5ed68a24' : '#2d8a4e24'),
      'editorIndentGuide.background1': borderSubtle,
      'editorIndentGuide.activeBackground1': border,
      'editorWhitespace.foreground': border,
      'editorWidget.background': surface,
      'editorWidget.border': border,
      'editorHoverWidget.background': surface,
      'editorHoverWidget.border': border,
      'editorFindMatch.background': withAlpha(accent, '55', dark ? '#5ed68a55' : '#2d8a4e55'),
      'scrollbarSlider.background': withAlpha(muted, '33', dark ? '#70707033' : '#8a8a8a33'),
      'scrollbarSlider.hoverBackground': withAlpha(muted, '55', dark ? '#70707055' : '#8a8a8a55'),
    },
  })
  monaco.editor.setTheme(themeName)
  return themeName
}

export function ReadonlyCodeEditor({
  value,
  path,
  language,
  ariaLabel,
}: {
  value: string
  path?: string
  language?: 'diff'
  ariaLabel: string
}) {
  const applicationTheme = useApplicationEditorTheme()
  const theme = `manta-${applicationTheme.mode}`
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    void setupLocalMonaco().then((monaco) => {
      applyApplicationEditorTheme(monaco, applicationTheme.mode)
      if (active) {
        setLoadError('')
        setReady(true)
      }
    }).catch((reason) => {
      if (active) setLoadError(reason instanceof Error ? reason.message : '内置编辑器加载失败')
    })
    return () => {
      active = false
    }
  }, [applicationTheme.mode, applicationTheme.revision])

  return (
    <div className="workspace-code-editor" data-editor-theme={theme}>
      {loadError ? <div className="file-preview-status is-error">{loadError}</div> : null}
      {ready ? <Editor
        value={value}
        path={path ? `manta-readonly://${path}` : undefined}
        language={language === 'diff' ? DIFF_LANGUAGE : languageForPath(path)}
        theme={theme}
        loading={<div className="file-preview-status">正在加载内置编辑器…</div>}
        options={{
          readOnly: true,
          domReadOnly: true,
          ariaLabel,
          automaticLayout: true,
          contextmenu: true,
          cursorBlinking: 'solid',
          cursorStyle: 'line-thin',
          folding: true,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          glyphMargin: false,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          renderLineHighlight: 'none',
          scrollBeyondLastLine: false,
          selectionHighlight: true,
          tabSize: 2,
          wordWrap: 'off',
        }}
      /> : loadError ? null : <div className="file-preview-status">正在加载内置编辑器…</div>}
    </div>
  )
}

export function ReadonlyDiffEditor({
  original,
  modified,
  path,
  ariaLabel,
}: {
  original: string
  modified: string
  path: string
  ariaLabel: string
}) {
  const applicationTheme = useApplicationEditorTheme()
  const theme = `manta-${applicationTheme.mode}`
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    void setupLocalMonaco().then((monaco) => {
      applyApplicationEditorTheme(monaco, applicationTheme.mode)
      if (active) {
        setLoadError('')
        setReady(true)
      }
    }).catch((reason) => {
      if (active) setLoadError(reason instanceof Error ? reason.message : '内置差异编辑器加载失败')
    })
    return () => {
      active = false
    }
  }, [applicationTheme.mode, applicationTheme.revision])

  return (
    <div className="workspace-code-editor" data-editor-theme={theme}>
      {loadError ? <div className="file-preview-status is-error">{loadError}</div> : null}
      {ready ? <DiffEditor
        original={original}
        modified={modified}
        originalModelPath={`manta-diff://original/${path}`}
        modifiedModelPath={`manta-diff://modified/${path}`}
        language={languageForPath(path)}
        theme={theme}
        loading={<div className="file-preview-status">正在加载拆分差异…</div>}
        options={{
          readOnly: true,
          domReadOnly: true,
          originalEditable: false,
          ariaLabel,
          automaticLayout: true,
          contextmenu: true,
          diffCodeLens: false,
          enableSplitViewResizing: true,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          glyphMargin: false,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          overviewRulerBorder: false,
          renderOverviewRuler: false,
          renderSideBySide: true,
          scrollBeyondLastLine: false,
          useInlineViewWhenSpaceIsLimited: false,
          wordWrap: 'off',
        }}
      /> : null}
    </div>
  )
}
