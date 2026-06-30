import React, { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const LINE_LIMIT = 6
const COLLAPSED_HEIGHT = 120

function countLines(children: React.ReactNode): number {
  const text = String(children ?? '').trimEnd()
  if (!text) return 0
  return text.split('\n').length
}

function CodeBlock({ isBlock, lang, children, ...props }: { isBlock: boolean; lang: string; children: React.ReactNode;[key: string]: unknown }) {
  if (!isBlock) {
    return <code style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '1.5px 5px', borderRadius: '4px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-emphasis)' }} {...props}>{children}</code>
  }

  const [expanded, setExpanded] = useState(false)
  const lines = useMemo(() => countLines(children), [children])
  const collapsible = lines > LINE_LIMIT

  return (
    <div style={{ margin: '6px 0', position: 'relative' }}>
      <div style={{ position: 'relative', maxHeight: expanded || !collapsible ? undefined : COLLAPSED_HEIGHT, overflow: 'hidden' }}>
        {lang && (
          <div style={{ fontSize: '9px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', padding: '2px 8px', background: 'var(--color-surface-elevated)', borderRadius: '5px 5px 0 0', border: '1px solid var(--color-border)', borderBottom: 'none' }}>
            {lang}
          </div>
        )}
        <pre style={{ margin: 0, padding: '8px 12px', overflowX: 'auto', fontSize: '10px', lineHeight: '1.45', fontFamily: 'var(--font-mono)', background: 'var(--color-surface-elevated)', borderRadius: lang ? '0 0 5px 5px' : '5px', border: '1px solid var(--color-border)' }}>
          <code style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)', fontSize: '10px' }} {...props}>{children}</code>
        </pre>
        {collapsible && !expanded && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '48px', background: 'linear-gradient(to bottom, transparent, var(--color-surface-elevated))', pointerEvents: 'none' }} />
        )}
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            position: 'absolute',
            bottom: '6px',
            right: '6px',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-text-muted)',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            zIndex: 1,
            transition: 'background-color var(--duration-fast) var(--ease-out-quart), color var(--duration-fast) var(--ease-out-quart)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; e.currentTarget.style.background = 'var(--color-surface-elevated)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'var(--color-surface)' }}
        >
          {expanded ? '收起' : `展开 ${lines} 行`}
        </button>
      )}
    </div>
  )
}

// 提取为模块级常量，避免每次渲染创建新对象导致 ReactMarkdown 重建 DOM
export const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  code({ className, children, ...props }) {
    const isBlock = className?.includes('language-')
    const lang = className?.replace('language-', '') ?? ''
    return <CodeBlock isBlock={isBlock} lang={lang} children={children} {...props} />
  },
  iframe({ src, ...props }) {
    return (
      <div style={{ margin: '8px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <div style={{ padding: '3px 10px', fontSize: '10px', color: 'var(--color-text-muted)', background: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>📄 预览</div>
        <iframe src={src} sandbox="allow-scripts allow-same-origin" style={{ width: '100%', minHeight: '300px', border: 'none', display: 'block' }} {...props} />
      </div>
    )
  },
  p({ children }) { return <p style={{ margin: '3px 0', lineHeight: '1.55' }}>{children}</p> },
  h1({ children }) { return <h1 style={{ fontSize: '17px', fontWeight: 700, margin: '10px 0 4px', letterSpacing: '-0.01em' }}>{children}</h1> },
  h2({ children }) { return <h2 style={{ fontSize: '14.5px', fontWeight: 600, margin: '8px 0 3px' }}>{children}</h2> },
  h3({ children }) { return <h3 style={{ fontSize: '13px', fontWeight: 600, margin: '6px 0 2px', color: 'var(--color-text-secondary)' }}>{children}</h3> },
  ul({ children }) { return <ul style={{ paddingLeft: '18px', margin: '3px 0', listStyleType: 'disc' }}>{children}</ul> },
  ol({ children }) { return <ol style={{ paddingLeft: '18px', margin: '3px 0', listStyleType: 'decimal' }}>{children}</ol> },
  li({ children }) { return <li style={{ margin: '1px 0', lineHeight: '1.5' }}>{children}</li> },
  hr() { return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '10px 0' }} /> },
  blockquote({ children }) { return <blockquote style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '10px', margin: '6px 0', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{children}</blockquote> },
  table({ children }) { return <div style={{ overflowX: 'auto', margin: '6px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>{children}</table></div> },
  th({ children }) { return <th style={{ padding: '5px 10px', borderBottom: '2px solid var(--color-border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th> },
  td({ children }) { return <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--color-border-subtle)' }}>{children}</td> },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{children}</a> },
  strong({ children }) { return <strong style={{ fontWeight: 700 }}>{children}</strong> },
  em({ children }) { return <em style={{ fontStyle: 'italic' }}>{children}</em> },
}
