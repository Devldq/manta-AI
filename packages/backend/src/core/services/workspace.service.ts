import type { WorkspaceConfig, CreateWorkspaceInput, UpdateWorkspaceInput } from '@core/types'
import {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '@core/storage/workspace/store'
import { validateWithZod } from '@core/api/error-handler'
import { CreateWorkspaceSchema, UpdateWorkspaceSchema } from '@manta/shared'

export function fetchWorkspaces(): WorkspaceConfig[] {
  return listWorkspaces()
}

export function getWorkspaceById(id: string): WorkspaceConfig | null {
  return getWorkspace(id)
}

export function createNewWorkspace(input: unknown): WorkspaceConfig {
  const data = validateWithZod(CreateWorkspaceSchema, input)
  return createWorkspace(data)
}

export function updateExistingWorkspace(id: string, input: unknown): WorkspaceConfig | null {
  const data = validateWithZod(UpdateWorkspaceSchema, input)
  return updateWorkspace(id, data)
}

export function deleteExistingWorkspace(id: string): boolean {
  return deleteWorkspace(id)
}

export function bindAgentApps(id: string, agentAppIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.agentAppIds)
  for (const appId of agentAppIds) {
    existing.add(appId)
  }
  return updateWorkspace(id, { agentAppIds: Array.from(existing) })
}

export function unbindAgentApps(id: string, agentAppIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.agentAppIds)
  for (const appId of agentAppIds) {
    existing.delete(appId)
  }
  return updateWorkspace(id, { agentAppIds: Array.from(existing) })
}

export function bindKnowledgeBases(id: string, knowledgeBaseIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.knowledgeBaseIds)
  for (const kbId of knowledgeBaseIds) {
    existing.add(kbId)
  }
  return updateWorkspace(id, { knowledgeBaseIds: Array.from(existing) })
}

export function unbindKnowledgeBases(id: string, knowledgeBaseIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.knowledgeBaseIds)
  for (const kbId of knowledgeBaseIds) {
    existing.delete(kbId)
  }
  return updateWorkspace(id, { knowledgeBaseIds: Array.from(existing) })
}

export function bindWorkflows(id: string, workflowIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.workflowIds)
  for (const wfId of workflowIds) {
    existing.add(wfId)
  }
  return updateWorkspace(id, { workflowIds: Array.from(existing) })
}

export function unbindWorkflows(id: string, workflowIds: string[]): WorkspaceConfig | null {
  const workspace = getWorkspace(id)
  if (!workspace) return null
  const existing = new Set(workspace.workflowIds)
  for (const wfId of workflowIds) {
    existing.delete(wfId)
  }
  return updateWorkspace(id, { workflowIds: Array.from(existing) })
}