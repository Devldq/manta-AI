/**
 * API 错误处理 — RAG 包自用（零外部依赖）
 */

import type { FastifyReply } from 'fastify'

// ─── 本地 API 响应类型（不依赖 @manta/shared） ──────────────

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ─── 应用错误基类 ──────────────────────────────────

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

// ─── 预定义错误工厂 ────────────────────────────────

export const Errors = {
  /** 资源不存在 */
  NOT_FOUND: (resource: string, id: string) =>
    new AppError('NOT_FOUND', `${resource} not found: ${id}`, 404),

  /** 验证失败 */
  VALIDATION_ERROR: (field: string, message: string) =>
    new AppError('VALIDATION_ERROR', `Validation failed: ${field} - ${message}`, 400),

  /** 资源冲突 */
  CONFLICT: (resource: string, id: string) =>
    new AppError('CONFLICT', `${resource} already exists: ${id}`, 409),

  /** 内部错误 */
  INTERNAL_ERROR: (message: string) =>
    new AppError('INTERNAL_ERROR', message, 500),

  /** 参数缺失 */
  MISSING_PARAM: (param: string) =>
    new AppError('MISSING_PARAM', `Missing required parameter: ${param}`, 400),

  /** 无效参数 */
  INVALID_PARAM: (param: string, reason: string) =>
    new AppError('INVALID_PARAM', `Invalid parameter ${param}: ${reason}`, 400),

  /** 未授权 */
  UNAUTHORIZED: (message = 'Unauthorized') =>
    new AppError('UNAUTHORIZED', message, 401),

  /** 禁止访问 */
  FORBIDDEN: (message = 'Forbidden') =>
    new AppError('FORBIDDEN', message, 403),
}

// ─── 响应辅助 ──────────────────────────────────────

/** API 成功响应 */
export function apiSuccess<T>(data: T): { success: true; data: T } {
  return { success: true, data }
}

/** 发送 API 错误响应 */
export function apiError(reply: FastifyReply, error: unknown): FastifyReply {
  console.error('API Error:', error)

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    })
  }

  if (error instanceof Error) {
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    })
  }

  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  })
}
