import { WorkspaceLogsPanel } from '@/features/logs/WorkspaceLogsPanel'
import type { SessionSidebarContext } from './tabs'

export function LogsTab({ conversationId, workspaceId }: SessionSidebarContext) {
  return (
    <WorkspaceLogsPanel
      conversationId={conversationId ?? undefined}
      workspaceId={workspaceId}
    />
  )
}
