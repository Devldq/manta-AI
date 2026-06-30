// ─── API 响应格式 ───────────────────────────────────────────────

/** 统一 API 成功响应格式 */
export interface ApiSuccessResponse<T> {
  success: true
  data: T
}

/** 统一 API 错误响应格式 */
export interface ApiErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/** API 响应类型 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

// ─── 数据目录 ───────────────────────────────────────────────

/** 默认数据根目录名 */
export const DEFAULT_DATA_DIR_NAME = '.manta-data'

/** 数据子目录名 */
export const DATA_DIRS = {
  APPS: 'apps',
  CONVERSATIONS: 'conversations',
  CONFIG: 'config',
  MEMORY: 'memory',
  TASKS: 'tasks',
  WORKFLOWS: 'workflows',
  WORKSPACES: 'workspaces',
  KNOWLEDGE_BASES: 'knowledge-bases',
  RAG: 'rag',
  PLUGINS: 'plugins',
  SKILLS: 'skills',
} as const

// ─── SSE 事件类型 ───────────────────────────────────────────────

/** SSE 事件类型枚举 */
export const SSE_EVENT_TYPES = {
  TEXT_DELTA: 'text-delta',
  TOOL_CALL: 'tool-call',
  TOOL_RESULT: 'tool-result',
  TOOL_ERROR: 'tool-error',
  FINISH: 'finish',
  ERROR: 'error',
  START: 'start',
  DONE: 'done',
} as const

// ─── HTTP 状态码 ───────────────────────────────────────────────

/** 常用 HTTP 状态码 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const

// ─── 默认配置 ───────────────────────────────────────────────

/** 默认 LLM 配置 */
export const DEFAULT_LLM_CONFIG = {
  MAX_OUTPUT_TOKENS: 1_000_000,
  MAX_STEPS: 200,
  TEMPERATURE: 0.7,
} as const

/** 默认压缩配置 */
export const DEFAULT_COMPACT_CONFIG = {
  TRUNCATE_HEAD_RATIO: 0.6,
  TRUNCATE_TAIL_RATIO: 0.4,
  TTL_SOFT_MINUTES: 5,
  TTL_HARD_MINUTES: 10,
} as const
