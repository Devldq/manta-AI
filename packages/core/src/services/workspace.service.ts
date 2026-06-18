import type { WorkspaceConfig, CreateWorkspaceInput, UpdateWorkspaceInput } from '../types'
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from '../storage/workspace/store'

export const workspaceService = {
  fetchWorkspaces(): WorkspaceConfig[] {
    return listWorkspaces()
  },

  getWorkspaceById(id: string): WorkspaceConfig | null {
    return getWorkspace(id)
  },

  createNewWorkspace(input: CreateWorkspaceInput): WorkspaceConfig {
    return createWorkspace(input)
  },

  updateExistingWorkspace(id: string, input: UpdateWorkspaceInput): WorkspaceConfig | null {
    return updateWorkspace(id, input)
  },

  deleteExistingWorkspace(id: string): boolean {
    return deleteWorkspace(id)
  }
}
