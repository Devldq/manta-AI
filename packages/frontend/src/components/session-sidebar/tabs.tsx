import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Files, GitPullRequestDraft, TerminalSquare } from 'lucide-react'
import { FilesTab } from './FilesTab'
import { ReviewTab } from './ReviewTab'
import { TerminalTab } from './TerminalTab'

export interface SessionSidebarContext {
  workspaceId: string | null
  conversationId: string | null
  previewPath: string | null
}

export interface SessionSidebarTabDefinition {
  id: string
  label: string
  icon: LucideIcon
  component: ComponentType<SessionSidebarContext>
}

export const BUILT_IN_SESSION_SIDEBAR_TABS: readonly SessionSidebarTabDefinition[] = [
  { id: 'review', label: '审阅', icon: GitPullRequestDraft, component: ReviewTab },
  { id: 'terminal', label: '终端', icon: TerminalSquare, component: TerminalTab },
  { id: 'files', label: '文件', icon: Files, component: FilesTab },
] as const

/**
 * Stable composition boundary for future panels (for example Logs).
 * Extensions append to the built-ins and cannot silently replace an existing tab.
 */
export function composeSessionSidebarTabs(
  extensions: readonly SessionSidebarTabDefinition[] = [],
): readonly SessionSidebarTabDefinition[] {
  const ids = new Set(BUILT_IN_SESSION_SIDEBAR_TABS.map((tab) => tab.id))
  const accepted = extensions.filter((tab) => {
    if (!tab.id || ids.has(tab.id)) return false
    ids.add(tab.id)
    return true
  })
  return [...BUILT_IN_SESSION_SIDEBAR_TABS, ...accepted]
}
