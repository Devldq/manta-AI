import { useEffect, useState } from 'react'
import Editor, { loader, type Monaco } from '@monaco-editor/react'

const DIFF_LANGUAGE = 'manta-unified-diff'
let localMonacoSetup: Promise<void> | null = null

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

function useSystemEditorTheme() {
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs'
  ))

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = () => setTheme(media.matches ? 'vs-dark' : 'vs')
    updateTheme()
    media.addEventListener('change', updateTheme)
    return () => media.removeEventListener('change', updateTheme)
  }, [])

  return theme
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
  const theme = useSystemEditorTheme()
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let active = true
    void setupLocalMonaco().then(() => {
      if (active) setReady(true)
    }).catch((reason) => {
      if (active) setLoadError(reason instanceof Error ? reason.message : '内置编辑器加载失败')
    })
    return () => {
      active = false
    }
  }, [])

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
