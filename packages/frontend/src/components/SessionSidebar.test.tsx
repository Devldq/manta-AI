import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SessionSidebar } from './SessionSidebar'

describe('SessionSidebar workspace tabs', () => {
  it('exposes a narrow Logs tab beside the existing conversation details', () => {
    const html = renderToStaticMarkup(
      <SessionSidebar
        open
        workspaceId="workspace-1"
        conversation={{
          id: 'conversation-1',
          title: 'Debug logs',
          agentName: 'main',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messages: [],
        }}
      />,
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('Logs')
    expect(html).toContain('详情')
    expect(html).toContain('aria-label="工作区"')
  })
})
