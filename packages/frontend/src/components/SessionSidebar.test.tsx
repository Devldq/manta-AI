import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Circle } from 'lucide-react'
import { SessionSidebar } from './SessionSidebar'
import { BUILT_IN_SESSION_SIDEBAR_TABS, composeSessionSidebarTabs } from './session-sidebar/tabs'

describe('SessionSidebar', () => {
  it('registers the three workspace tabs in a stable order', () => {
    expect(BUILT_IN_SESSION_SIDEBAR_TABS.map((tab) => tab.id)).toEqual(['review', 'terminal', 'files'])
  })

  it('renders an accessible compact tablist', () => {
    const html = renderToStaticMarkup(
      <SessionSidebar
        open
        workspaceId="workspace-a"
        conversation={{
          id: 'conversation-a',
          title: 'Sidebar',
          agentName: 'main',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
          messages: [],
        }}
      />,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="工作区工具"')
    expect(html).toContain('aria-selected="true"')
    for (const label of ['审阅', '终端', '文件']) expect(html).toContain(label)
  })

  it('appends extensions without allowing built-ins to be replaced', () => {
    const component = () => null
    const tabs = composeSessionSidebarTabs([
      { id: 'logs', label: '日志', icon: Circle, component },
      { id: 'review', label: '错误替换', icon: Circle, component },
    ])
    expect(tabs.map((tab) => tab.id)).toEqual(['review', 'terminal', 'files', 'logs'])
    expect(tabs[0].label).toBe('审阅')
  })
})
