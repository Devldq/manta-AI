'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 提取为模块级常量，避免每次渲染创建新对象导致 ReactMarkdown 重建 DOM
export const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  code({ className, children, ...props }) {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      const lang = className?.replace('language-', '') ?? ''
      return (
        <div style={{ margin: '8px 0' }}>
          {lang && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', padding: '4px 12px', background: 'var(--color-surface-elevated)', borderRadius: '6px 6px 0 0', border: '1px solid var(--color-border)', borderBottom: 'none' }}>
              {lang}
            </div>
          )}
          <pre style={{ margin: 0, padding: '12px 16px', overflowX: 'auto', fontSize: '13px', lineHeight: '1.6', fontFamily: 'var(--font-mono)', background: 'var(--color-surface-elevated)', borderRadius: lang ? '0 0 6px 6px' : '6px', border: '1px solid var(--color-border)' }}>
            <code style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }} {...props}>{children}</code>
          </pre>
        </div>
      )
    }
    return <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-emphasis)' }} {...props}>{children}</code>
  },
  iframe({ src, ...props }) {
    return (
      <div style={{ margin: '12px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
        <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--color-text-muted)', background: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>📄 预览</div>
        <iframe src={src} sandbox="allow-scripts allow-same-origin" style={{ width: '100%', minHeight: '300px', border: 'none', display: 'block' }} {...props} />
      </div>
    )
  },
  p({ children }) { return <p style={{ margin: '4px 0', lineHeight: '1.7' }}>{children}</p> },
  h1({ children }) { return <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '12px 0 6px' }}>{children}</h1> },
  h2({ children }) { return <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '10px 0 5px' }}>{children}</h2> },
  h3({ children }) { return <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '8px 0 4px' }}>{children}</h3> },
  ul({ children }) { return <ul style={{ paddingLeft: '20px', margin: '4px 0', listStyleType: 'disc' }}>{children}</ul> },
  ol({ children }) { return <ol style={{ paddingLeft: '20px', margin: '4px 0', listStyleType: 'decimal' }}>{children}</ol> },
  li({ children }) { return <li style={{ margin: '2px 0', lineHeight: '1.6' }}>{children}</li> },
  hr() { return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} /> },
  blockquote({ children }) { return <blockquote style={{ borderLeft: '3px solid var(--color-accent)', paddingLeft: '12px', margin: '8px 0', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{children}</blockquote> },
  table({ children }) { return <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: '13px', width: '100%' }}>{children}</table></div> },
  th({ children }) { return <th style={{ padding: '6px 12px', borderBottom: '2px solid var(--color-border)', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</th> },
  td({ children }) { return <td style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border-subtle)' }}>{children}</td> },
  a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '2px' }}>{children}</a> },
  strong({ children }) { return <strong style={{ fontWeight: 700 }}>{children}</strong> },
  em({ children }) { return <em style={{ fontStyle: 'italic' }}>{children}</em> },
}
