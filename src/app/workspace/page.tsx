/* 工作空间管理页 — /workspace (Server Component 壳) */
import { fetchWorkspaces } from '@/core/services/workspace.service'
import WorkspacePageClient from './WorkspacePageClient'

export default async function WorkspacePage() {
  // 在服务端预取数据
  const workspaces = fetchWorkspaces()

  return <WorkspacePageClient initialWorkspaces={workspaces} />
}
