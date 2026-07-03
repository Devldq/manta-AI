/**
 * API 错误处理
 */

import type { FastifyReply } from 'fastify'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

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

export const Errors = {
  NOT_FOUND: (resource: string, id: string) =>
    new AppError('NOT_FOUND', `${resource} not found: ${id}`, 404),

  VALIDATION_ERROR: (field: string, message: string) =>
    new AppError('VALIDATION_ERROR', `Validation failed: ${field} - ${message}`, 400),

  CONFLICT: (resource: string, id: string) =>
    new AppError('CONFLICT', `${resource} already exists: ${id}`, 409),

  INTERNAL_ERROR: (message: string) =>
    new AppError('INTERNAL_ERROR', message, 500),

  MISSING_PARAM: (param: string) =>
    new AppError('MISSING_PARAM', `Missing required parameter: ${param}`, 400),

  INVALID_PARAM: (param: string, reason: string) =>
    new AppError('INVALID_PARAM', `Invalid parameter ${param}: ${reason}`, 400),

  UNAUTHORIZED: (message = 'Unauthorized') =>
    new AppError('UNAUTHORIZED', message, 401),

  FORBIDDEN: (message = 'Forbidden') =>
    new AppError('FORBIDDEN', message, 403),
}

export function apiSuccess<T>(data: T): { success: true; data: T } {
  return { success: true, data }
}

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

/** 验证必填参数 */
export function requireParam(value: unknown, name: string): asserts value is NonNullable<typeof value> {
  if (value === undefined || value === null || value === '') {
    throw Errors.MISSING_PARAM(name)
  }
}

/** 验证参数类型 */
export function requireString(value: unknown, name: string): asserts value is string {
  requireParam(value, name)
  if (typeof value !== 'string') {
    throw Errors.INVALID_PARAM(name, 'must be a string')
  }
}

/** Zod 验证辅助函数 */
export function validateWithZod<T>(
  schema: { parse: (data: unknown) => T },
  data: unknown
): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof Error && 'issues' in error) {
      const zodError = error as { issues: Array<{ path: (string | number)[]; message: string }> }
      const firstIssue = zodError.issues[0]
      const field = firstIssue?.path?.join('.') || 'unknown'
      throw Errors.VALIDATION_ERROR(field, firstIssue?.message || 'Validation failed')
    }
    throw error
  }
}

/** Fastify API 响应包装器 - 自动处理错误并返回 JSON */
export async function apiHandler<T>(
  handler: () => Promise<T>
): Promise<{ success: true; data: T } | { success: false; error: { code: string; message: string; details?: Record<string, unknown> } }> {
  try {
    const data = await handler()
    return apiSuccess(data)
  } catch (error) {
    if (error instanceof AppError) {
      return {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      }
    }
    if (error instanceof Error) {
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message },
      }
    }
    return {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    }
  }
}
