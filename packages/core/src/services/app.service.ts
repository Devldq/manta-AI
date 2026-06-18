import type { AppConfig, CreateAppInput, UpdateAppInput } from '../types'
import {
  createApp,
  listApps,
  getApp,
  updateApp,
  deleteApp,
} from '../storage/app/store'

export const appService = {
  fetchApps(params?: { sort?: string }): AppConfig[] {
    return listApps()
  },

  getAppById(id: string): AppConfig | null {
    return getApp(id)
  },

  createNewApp(input: CreateAppInput): AppConfig {
    return createApp(input)
  },

  updateExistingApp(id: string, input: UpdateAppInput): AppConfig | null {
    return updateApp(id, input)
  },

  deleteExistingApp(id: string): boolean {
    return deleteApp(id)
  }
}
