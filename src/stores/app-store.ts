/*  App Zustand Store — 应用列表状态管理 */

import { create } from 'zustand'
import type { AppConfig, CreateAppInput, UpdateAppInput, AppStatus } from '@/core/types'

interface AppStore {
  apps: AppConfig[]
  loading: boolean
  error: string | null

  fetchApps: (params?: { search?: string; status?: AppStatus; sort?: string }) => Promise<void>
  createApp: (input: CreateAppInput) => Promise<AppConfig | null>
  updateApp: (id: string, patch: UpdateAppInput) => Promise<AppConfig | null>
  deleteApp: (id: string) => Promise<boolean>
  cloneApp: (id: string, name?: string) => Promise<AppConfig | null>
  changeStatus: (id: string, status: AppStatus) => Promise<AppConfig | null>
}

export const useAppStore = create<AppStore>((set, get) => ({
  apps: [],
  loading: false,
  error: null,

  fetchApps: async (params) => {
    set({ loading: true, error: null })
    try {
      const sp = new URLSearchParams()
      if (params?.search) sp.set('search', params.search)
      if (params?.status) sp.set('status', params.status)
      if (params?.sort) sp.set('sort', params.sort)
      const qs = sp.toString()
      const res = await fetch(`/api/apps${qs ? `?${qs}` : ''}`)
      const data = await res.json()
      if (data.apps) {
        set({ apps: data.apps, loading: false })
      } else {
        set({ loading: false, error: data.error ?? '获取应用列表失败' })
      }
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  createApp: async (input) => {
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await res.json()
      if (data.app) {
        set((s) => ({ apps: [data.app, ...s.apps] }))
        return data.app
      }
      set({ error: data.error ?? '创建失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  updateApp: async (id, patch) => {
    try {
      const existing = get().apps.find((a) => a.id === id)
      const res = await fetch(`/api/apps/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, version: existing?.version }),
      })
      const data = await res.json()
      if (data.app) {
        set((s) => ({
          apps: s.apps.map((a) => (a.id === id ? data.app : a)),
        }))
        return data.app
      }
      if (res.status === 409) {
        // 乐观锁冲突：重新获取列表
        await get().fetchApps()
      }
      set({ error: data.error ?? '更新失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  deleteApp: async (id) => {
    try {
      const res = await fetch(`/api/apps/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        set((s) => ({ apps: s.apps.filter((a) => a.id !== id) }))
        return true
      }
      set({ error: data.error ?? '删除失败' })
      return false
    } catch (err) {
      set({ error: String(err) })
      return false
    }
  },

  cloneApp: async (id, name) => {
    try {
      const res = await fetch(`/api/apps/${id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (data.app) {
        set((s) => ({ apps: [data.app, ...s.apps] }))
        return data.app
      }
      set({ error: data.error ?? '复制失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },

  changeStatus: async (id, status) => {
    try {
      const res = await fetch(`/api/apps/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (data.app) {
        set((s) => ({
          apps: s.apps.map((a) => (a.id === id ? data.app : a)),
        }))
        return data.app
      }
      set({ error: data.error ?? '状态变更失败' })
      return null
    } catch (err) {
      set({ error: String(err) })
      return null
    }
  },
}))
