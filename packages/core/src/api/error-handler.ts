/* 统一API响应格式与错误处理 - 通用版本（不依赖 Next.js） */

/** 应用错误基类 */
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

/** 预定义错误工厂 */
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

/** API 响应格式 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/** API 成功响应 */
export function apiSuccess<T>(data: T): ApiResponse<T> {
  return { success: true, data }
}

/** API 错误响应 */
export function apiError(error: unknown): ApiResponse {
  console.error('API Error:', error)

  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    }
  }

  if (error instanceof Error) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      },
    }
  }

  return {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  }
}

/** API 响应包装器 - 自动处理错误 */
export async function apiHandler<T>(
  handler: () => Promise<T>
): Promise<ApiResponse<T>> {
  try {
    const data = await handler()
    return apiSuccess(data) as ApiResponse<T>
  } catch (error) {
    return apiError(error) as ApiResponse<T>
  }
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

/** 验证数字范围 */
export function requireNumberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number
): asserts value is number {
  requireParam(value, name)
  if (typeof value !== 'number' || value < min || value > max) {
    throw Errors.INVALID_PARAM(name, `must be a number between ${min} and ${max}`)
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
