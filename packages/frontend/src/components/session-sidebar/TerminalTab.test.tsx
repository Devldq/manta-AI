import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./TerminalTab.tsx', import.meta.url), 'utf8')

describe('TerminalTab', () => {
  it('renders every system shell session through an interactive xterm canvas', () => {
    expect(source).toContain('/api/workspace-sidebar/terminal/sessions?')
    expect(source).toContain('sessions.map((session, sessionIndex)')
    expect(source).toContain("import { Terminal } from '@xterm/xterm'")
    expect(source).toContain('terminal.onData')
    expect(source).toContain("type: 'resize'")
    expect(source).toContain('role="tablist"')
    expect(source).toContain("event.key === 'ArrowRight'")
    expect(source).toContain('role="tabpanel"')
    expect(source).not.toContain('terminal/current')
    expect(source).not.toContain('new EventSource')
    expect(source).not.toContain('iTerm2')
  })

  it('uses raw WebSocket I/O instead of a command form', () => {
    expect(source).toContain('new WebSocket')
    expect(source).toContain("type: 'input'")
    expect(source).not.toContain('<form')
    expect(source).not.toContain('submitCommand')
    expect(source).toContain('closeSession(session)')
    expect(source).toContain('新建终端')
  })
})
