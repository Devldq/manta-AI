import type { AppConfig, CreateAppInput, UpdateAppInput } from '@/core/types'
import {
  listApps,
  getApp,
  createApp,
  updateApp,
  deleteApp,
  cloneApp,
  updateAppStatus,
} from '@/core/storage/app/store'
import { validateWithZod } from '@/core/api/error-handler'
import { CreateAppSchema, UpdateAppSchema } from '@/core/api/schemas/app.schema'

export function fetchApps(params?: {
  search?: string
  status?: AppConfig['status']
  sort?: string
}): AppConfig[] {
  let apps = listApps()

  // 搜索过滤
  if (params?.search) {
    const search = params.search.toLowerCase()
    apps = apps.filter(
      (a) =>
        a.name.toLowerCase().includes(search) ||
        a.description.toLowerCase().includes(search) ||
        a.tags.some((t) => t.toLowerCase().includes(search))
    )
  }

  // 状态过滤
  if (params?.status && ['draft', 'published', 'archived'].includes(params.status)) {
    apps = apps.filter((a) => a.status === params.status)
  }

  // 排序
  if (params?.sort === 'name') {
    apps.sort((a, b) => a.name.localeCompare(b.name))
  } else if (params?.sort === 'createdAt') {
    apps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } else {
    // 默认按更新时间倒序
    apps.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  return apps
}

export function createNewApp(input: unknown): AppConfig {
  const data = validateWithZod(CreateAppSchema, input)
  return createApp(data)
}

export function updateExistingApp(id: string, input: unknown): AppConfig | null {
  const data = validateWithZod(UpdateAppSchema, input)
  return updateApp(id, data)
}

export function deleteExistingApp(id: string): boolean {
  return deleteApp(id)
}

export function cloneExistingApp(id: string, name?: string): AppConfig | null {
  return cloneApp(id, name)
}

export function changeAppStatus(id: string, status: AppConfig['status']): AppConfig | null {
  return updateAppStatus(id, status)
}