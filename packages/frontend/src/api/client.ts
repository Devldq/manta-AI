/**
 * API 客户端层 — 统一封装与 Fastify 后端的通信
 */

const API_BASE = ''

interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: { code: string; message: string; details?: Record<string, unknown> }
  message?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })
  return res.json()
}

// ─── Conversations ─────────────────────────────────────────

export interface ConversationSummary {
  id: string
  title: string
  agentName: string
  messages: Array<{ id: string }>
  createdAt: string
  updatedAt: string
  workspaceId?: string
}

export const conversationsApi = {
  list: (params?: { workspaceId?: string }) => {
    const sp = new URLSearchParams()
    if (params?.workspaceId) sp.set('workspaceId', params.workspaceId)
    const qs = sp.toString()
    return request<{ conversations: ConversationSummary[] }>(`/api/conversations${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => request<{ conversation: ConversationSummary }>(`/api/conversations/${id}`),
  delete: (id: string) => request(`/api/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (id: string, content: string, agentAppId?: string) =>
    request(`/api/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, agentAppId }),
    }),
}

// ─── Apps ──────────────────────────────────────────────────

export interface AppConfig {
  id: string
  name: string
  description?: string
  status: string
  version: number
  createdAt: string
  updatedAt: string
}

export const appsApi = {
  list: (params?: { search?: string; status?: string; sort?: string }) => {
    const sp = new URLSearchParams()
    if (params?.search) sp.set('search', params.search)
    if (params?.status) sp.set('status', params.status)
    if (params?.sort) sp.set('sort', params.sort)
    const qs = sp.toString()
    return request<{ apps: AppConfig[] }>(`/api/apps${qs ? `?${qs}` : ''}`)
  },
  get: (id: string) => request<{ app: AppConfig }>(`/api/apps/${id}`),
  create: (input: Record<string, unknown>) =>
    request<{ app: AppConfig }>('/api/apps', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, patch: Record<string, unknown>) =>
    request<{ app: AppConfig }>(`/api/apps/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  delete: (id: string) => request(`/api/apps/${id}`, { method: 'DELETE' }),
}

// ─── Config ────────────────────────────────────────────────

export const configApi = {
  get: () => request('/api/config'),
}

// ─── Health ────────────────────────────────────────────────

export const healthApi = {
  check: () => request('/api/health'),
}
