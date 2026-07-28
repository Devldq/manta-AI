import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./TerminalTab.tsx', import.meta.url), 'utf8')

describe('TerminalTab', () => {
  it('discovers and renders multiple iTerm2 sessions instead of a single current shell', () => {
    expect(source).toContain('/api/workspace-sidebar/terminal/capabilities')
    expect(source).toContain('/api/workspace-sidebar/terminal/sessions?')
    expect(source).toContain('sessions.map((session, sessionIndex)')
    expect(source).toContain('role="tablist"')
    expect(source).toContain("event.key === 'ArrowRight'")
    expect(source).toContain('role="tabpanel"')
    expect(source).not.toContain('terminal/current')
    expect(source).not.toContain('new EventSource')
  })

  it('keeps iTerm2 session controls reachable from the active terminal', () => {
    expect(source).toContain('/focus')
    expect(source).toContain('在 iTerm2 中打开')
    expect(source).toContain('closeSession(session)')
    expect(source).toContain('新建 iTerm2 终端')
  })
})
