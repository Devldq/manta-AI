/* core/tools/file-ops — 文件操作工具集（接入安全沙箱 SDK）
 *
 * 工具列表：
 * - read       — 读取文件内容
 * - write      — 写入/覆盖文件
 * - edit       — 精确字符串替换
 * - multiEdit  — 批量字符串替换
 */
import type { ToolDefinition } from '@tools/registry'
import * as fs from 'fs'
import * as path from 'path'
import { approvalManager } from '@security/ApprovalManager'

// ─── 从 @manta/agent-sandbox 复制的必要函数 ────────────────────────────────

import * as os from 'os'

// ─── 类型定义 ─────────────────────────────────────────────────────────────

interface SecurityContextType {
  taskId?: string
  workspaceId?: string
  allowedRoots: string[]
  shellAllowedRoots: string[]
  networkAccess: boolean
  maxFileSize: number
  platform: string
}

interface PathValidationResult {
  allowed: boolean
  needApproval: boolean
  reason?: string
}

// ─── 安全上下文存储（简化版）────────────────────────────────────────────

const securityContextStorage: { getStore: () => SecurityContextType | undefined } = {
  getStore: () => undefined,
}

// ─── 路径验证函数 ─────────────────────────────────────────────────────────

function normalizePath(inputPath: string): string {
  if (inputPath.startsWith('~')) {
    return path.join(os.homedir(), inputPath.slice(1))
  }
  return path.resolve(inputPath)
}

function isPathInAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  if (!allowedRoots || allowedRoots.length === 0) return false
  const normalizedTarget = normalizePath(targetPath)
  return allowedRoots.some((root) => {
    const normalizedRoot = normalizePath(root)
    const relative = path.relative(normalizedRoot, normalizedTarget)
    return !relative.startsWith('..') && !path.isAbsolute(relative)
  })
}

function getSecurityContext(): SecurityContextType | undefined {
  return securityContextStorage.getStore()
}

function validatePathAccess(targetPath: string, accessType: 'read' | 'write'): PathValidationResult {
  const context = getSecurityContext()
  
  if (!context) {
    return {
      allowed: false,
      needApproval: false,
      reason: '安全上下文未初始化',
    }
  }
  
  const isInAllowedRoots = isPathInAllowedRoots(targetPath, context.allowedRoots)
  
  if (isInAllowedRoots) {
    return {
      allowed: true,
      needApproval: false,
    }
  }
  
  // 不在允许范围内，需要检查外部访问策略
  const allowExternalRead = (context as any).allowExternalRead || false
  const allowExternalWrite = (context as any).allowExternalWrite || false
  
  if (accessType === 'read' && allowExternalRead) {
    return {
      allowed: false,
      needApproval: true,
      reason: `路径 ${targetPath} 不在允许的根路径内，需要授权才能读取`,
    }
  }
  
  if (accessType === 'write' && allowExternalWrite) {
    return {
      allowed: false,
      needApproval: true,
      reason: `路径 ${targetPath} 不在允许的根路径内，需要授权才能写入`,
    }
  }
  
  return {
    allowed: false,
    needApproval: false,
    reason: `路径 ${targetPath} 不在允许的根路径内，且不允许外部${accessType === 'read' ? '读取' : '写入'}`,
  }
}

// ─── 工具定义 ─────────────────────────────────────────────────────────────

/** Read — 读取文件内容 */
function createReadTool(): ToolDefinition {
  return {
    name: 'read',
    description: '读取指定路径的文件内容。支持按行号范围截取（适合大文件局部读取）。图片文件会以视觉形式呈现。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件绝对路径或相对路径' },
        offset: { type: 'integer', minimum: 1, description: '起始行号（从 1 开始）' },
        limit: { type: 'integer', minimum: 1, description: '最多读取的行数' },
      },
      required: ['file_path'],
    },
    shouldDefer: true,
    isConcurrencySafe: true,
    searchHint: 'read file content view inspect text lines',
    execute: async (input: any) => {
      const { file_path, offset, limit } = input
      const resolved = path.resolve(file_path)
      
      // 路径安全校验
      const validation = validatePathAccess(resolved, 'read')
      if (!validation.allowed) {
        // 如果需要授权，创建授权请求并等待用户响应
        if (validation.needApproval) {
          const context = getSecurityContext()
          const requestedBy = context?.taskId || 'unknown'
          
          // 创建授权请求
          const requestId = approvalManager.createRequest('read', requestedBy, resolved)
          
          // 等待用户响应（最多 60 秒）
          const approved = await approvalManager.waitForResponse(requestId, 60000)
          
          if (!approved) {
            return { error: '用户拒绝访问或超时', path: resolved }
          }
          
          // 用户已批准，继续执行
        } else {
          return { error: validation.reason || '读取访问被拒绝', path: resolved }
        }
      }
      
      if (!fs.existsSync(resolved)) {
        return { error: `文件不存在：${resolved}` }
      }
      const stat = fs.statSync(resolved)
      if (!stat.isFile()) {
        return { error: `路径不是文件：${resolved}` }
      }

      const raw = fs.readFileSync(resolved, 'utf-8')
      const lines = raw.split('\n')
      const totalLines = lines.length

      const start = Math.max((offset ?? 1) - 1, 0)
      const end = limit !== undefined ? Math.min(start + limit, totalLines) : totalLines
      const sliced = lines.slice(start, end)

      return {
        file_path: resolved,
        totalLines,
        offset: start + 1,
        limit: sliced.length,
        content: sliced.join('\n'),
      }
    },
  }
}

/** Write — 写入/覆盖文件 */
function createWriteTool(): ToolDefinition {
  return {
    name: 'write',
    description: '将内容写入文件（覆盖）。若文件不存在则创建，若父目录不存在也会自动创建。写入前应先用 Read 读取现有内容以避免意外覆盖。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件绝对路径或相对路径' },
        content: { type: 'string', description: '要写入的完整文件内容' },
      },
      required: ['file_path', 'content'],
    },
    shouldDefer: true,
    isConcurrencySafe: false,
    searchHint: 'write create file save overwrite content output',
    execute: async (input: any) => {
      const { file_path, content } = input
      const resolved = path.resolve(file_path)
      
      // 路径安全校验
      const validation = validatePathAccess(resolved, 'write')
      if (!validation.allowed) {
        // 如果需要授权，创建授权请求并等待用户响应
        if (validation.needApproval) {
          const context = getSecurityContext()
          const requestedBy = context?.taskId || 'unknown'
          
          // 创建授权请求
          const requestId = approvalManager.createRequest('write', requestedBy, resolved)
          
          // 等待用户响应（最多 60 秒）
          const approved = await approvalManager.waitForResponse(requestId, 60000)
          
          if (!approved) {
            return { error: '用户拒绝访问或超时', path: resolved }
          }
          
          // 用户已批准，继续执行
        } else {
          return { error: validation.reason || '写入访问被拒绝', path: resolved }
        }
      }
      
      const dir = path.dirname(resolved)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(resolved, content, 'utf-8')
      const lines = content.split('\n').length
      return { success: true, file_path: resolved, linesWritten: lines }
    },
  }
}

/** Edit — 精确字符串替换 */
function createEditTool(): ToolDefinition {
  return {
    name: 'edit',
    description: '对文件做精确的字符串替换。old_string 必须在文件中唯一存在（否则失败）。若需替换所有匹配项，设 replace_all: true。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '要修改的文件路径' },
        old_string: { type: 'string', description: '要被替换的原始字符串（必须精确匹配）' },
        new_string: { type: 'string', description: '替换后的新字符串' },
        replace_all: {
          type: 'boolean',
          description: '是否替换文件中所有匹配项，默认 false（只替换一处，且要求唯一）',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    shouldDefer: true,
    isConcurrencySafe: false,
    searchHint: 'edit modify replace update change string file',
    execute: async (input: any) => {
      const { file_path, old_string, new_string, replace_all = false } = input
      const resolved = path.resolve(file_path)
      
      // 路径安全校验
      const validation = validatePathAccess(resolved, 'write')
      if (!validation.allowed) {
        // 如果需要授权，创建授权请求并等待用户响应
        if (validation.needApproval) {
          const context = getSecurityContext()
          const requestedBy = context?.taskId || 'unknown'
          
          // 创建授权请求
          const requestId = approvalManager.createRequest('write', requestedBy, resolved)
          
          // 等待用户响应（最多 60 秒）
          const approved = await approvalManager.waitForResponse(requestId, 60000)
          
          if (!approved) {
            return { error: '用户拒绝访问或超时', path: resolved }
          }
          
          // 用户已批准，继续执行
        } else {
          return { error: validation.reason || '编辑访问被拒绝', path: resolved }
        }
      }
      
      if (!fs.existsSync(resolved)) {
        return { error: `文件不存在：${resolved}` }
      }

      const content = fs.readFileSync(resolved, 'utf-8')

      if (!replace_all) {
        const count = content.split(old_string).length - 1
        if (count === 0) {
          return { error: '未找到目标字符串，请检查 old_string 是否与文件内容精确匹配' }
        }
        if (count > 1) {
          return {
            error: `找到 ${count} 处匹配，old_string 不唯一。请提供更多上下文使其唯一，或设置 replace_all: true`,
          }
        }
      }

      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string)

      fs.writeFileSync(resolved, updated, 'utf-8')

      const replacedCount = replace_all ? content.split(old_string).length - 1 : 1
      return { success: true, file_path: resolved, replacedCount }
    },
  }
}

/** MultiEdit — 批量字符串替换（单次调用） */
function createMultiEditTool(): ToolDefinition {
  return {
    name: 'multiEdit',
    description: '对同一文件进行多处字符串替换（原子操作，按顺序执行）。适合需要一次性修改多处的场景，比多次调用 Edit 更高效。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '要修改的文件路径' },
        edits: {
          type: 'array',
          description: '替换操作列表，按顺序执行',
          items: {
            type: 'object',
            properties: {
              old_string: { type: 'string', description: '要被替换的原始字符串' },
              new_string: { type: 'string', description: '替换后的新字符串' },
              replace_all: { type: 'boolean', description: '是否替换所有匹配项' },
            },
            required: ['old_string', 'new_string'],
          },
        },
      },
      required: ['file_path', 'edits'],
    },
    shouldDefer: true,
    isConcurrencySafe: false,
    searchHint: 'batch multiple edit replace file modify string atomic',
    execute: async (input: any) => {
      const { file_path, edits } = input
      const resolved = path.resolve(file_path)
      
      // 路径安全校验
      const validation = validatePathAccess(resolved, 'write')
      if (!validation.allowed) {
        // 如果需要授权，创建授权请求并等待用户响应
        if (validation.needApproval) {
          const context = getSecurityContext()
          const requestedBy = context?.taskId || 'unknown'
          
          // 创建授权请求
          const requestId = approvalManager.createRequest('write', requestedBy, resolved)
          
          // 等待用户响应（最多 60 秒）
          const approved = await approvalManager.waitForResponse(requestId, 60000)
          
          if (!approved) {
            return { error: '用户拒绝访问或超时', path: resolved }
          }
          
          // 用户已批准，继续执行
        } else {
          return { error: validation.reason || '批量编辑访问被拒绝', path: resolved }
        }
      }
      
      if (!fs.existsSync(resolved)) {
        return { error: `文件不存在：${resolved}` }
      }

      let content = fs.readFileSync(resolved, 'utf-8')
      const results: Array<{ index: number; replacedCount: number; error?: string }> = []

      for (let i = 0; i < edits.length; i++) {
        const { old_string, new_string, replace_all = false } = edits[i]
        const count = content.split(old_string).length - 1

        if (count === 0) {
          results.push({ index: i, replacedCount: 0, error: '未找到目标字符串' })
          continue
        }
        if (!replace_all && count > 1) {
          results.push({ index: i, replacedCount: 0, error: `找到 ${count} 处匹配，需提供更多上下文或设置 replace_all: true` })
          continue
        }

        content = replace_all
          ? content.split(old_string).join(new_string)
          : content.replace(old_string, new_string)

        results.push({ index: i, replacedCount: replace_all ? count : 1 })
      }

      const hasError = results.some((r) => r.error)
      if (!hasError) {
        fs.writeFileSync(resolved, content, 'utf-8')
      }

      return {
        success: !hasError,
        file_path: resolved,
        results,
        ...(hasError ? { error: '部分替换失败，文件未修改' } : {}),
      }
    },
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────────

/** 创建所有文件操作工具（CC 风格，无访问控制） */
export function createFileOpsTools(): ToolDefinition[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createMultiEditTool(),
  ]
}
