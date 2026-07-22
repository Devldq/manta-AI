import type { FastifyInstance } from 'fastify'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { grantAccess, denyAccess, listPendingRequests, requestAccess } from '../core/security/fs-access'
import { getWorkspace } from '../core/storage/workspace/store'

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const MAX_IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function decodePreviewPath(value: string): string {
  const withoutScheme = value.startsWith('file://') ? value.slice('file://'.length) : value
  try {
    return decodeURIComponent(withoutScheme)
  } catch {
    return withoutScheme
  }
}

async function resolveWorkspacePreviewPath(workspaceId: string, requestedPath: string) {
  const workspace = getWorkspace(workspaceId)
  if (!workspace?.folderPath) throw Object.assign(new Error('当前工作区未绑定本地文件夹'), { statusCode: 400 })

  const root = await realpath(workspace.folderPath)
  const decodedPath = decodePreviewPath(requestedPath)
  const candidate = await realpath(isAbsolute(decodedPath) ? decodedPath : resolve(root, decodedPath))
  const relativePath = relative(root, candidate)
  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) {
    throw Object.assign(new Error('只能预览当前工作区内的文件'), { statusCode: 403 })
  }

  return { candidate, relativePath: relativePath || '.' }
}

export async function fsRoutes(app: FastifyInstance) {
  // GET /api/fs/preview — 安全读取当前工作区内的文本或图片文件
  app.get('/api/fs/preview', async (request, reply) => {
    const query = request.query as { workspaceId?: string; path?: string }
    if (!query.workspaceId || !query.path) {
      return reply.status(400).send({ error: '缺少 workspaceId 或 path 参数' })
    }

    try {
      const { candidate, relativePath } = await resolveWorkspacePreviewPath(query.workspaceId, query.path)
      const fileStat = await stat(candidate)
      if (!fileStat.isFile()) return reply.status(400).send({ error: '目标不是文件' })

      const extension = extname(candidate).toLowerCase()
      const imageMime = IMAGE_MIME_TYPES[extension]
      if (imageMime) {
        if (fileStat.size > MAX_IMAGE_PREVIEW_BYTES) {
          return reply.status(413).send({ error: '图片超过 5 MB，无法预览' })
        }
        const content = await readFile(candidate)
        return reply.send({
          kind: 'image',
          path: relativePath,
          mimeType: imageMime,
          size: fileStat.size,
          content: content.toString('base64'),
        })
      }

      if (fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
        return reply.status(413).send({ error: '文件超过 1 MB，无法预览' })
      }
      const content = await readFile(candidate, 'utf8')
      return reply.send({ kind: 'text', path: relativePath, size: fileStat.size, content })
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error
        ? Number((error as { statusCode: number }).statusCode)
        : 404
      const message = error instanceof Error ? error.message : '无法读取文件'
      return reply.status(statusCode).send({ error: message })
    }
  })

  // GET /api/fs/request-access — 获取所有 pending 的授权请求
  app.get('/api/fs/request-access', async (_request, reply) => {
    return reply.send(listPendingRequests())
  })

  // POST /api/fs/request-access — 发起授权请求
  app.post('/api/fs/request-access', async (request, reply) => {
    const body = request.body as { path?: string }
    if (!body.path || typeof body.path !== 'string') {
      return reply.status(400).send({ error: '缺少 path 参数' })
    }
    const req = requestAccess(body.path)
    return reply.send(req)
  })

  // POST /api/fs/grant-access — 批准或拒绝授权请求
  app.post('/api/fs/grant-access', async (request, reply) => {
    const body = request.body as { requestId?: string; action?: string }
    if (!body.requestId || typeof body.requestId !== 'string') {
      return reply.status(400).send({ error: '缺少 requestId 参数' })
    }
    if (body.action !== 'grant' && body.action !== 'deny') {
      return reply.status(400).send({ error: 'action 必须为 grant 或 deny' })
    }
    const ok = body.action === 'grant' ? grantAccess(body.requestId) : denyAccess(body.requestId)
    if (!ok) return reply.status(404).send({ error: `授权请求 ${body.requestId} 不存在` })
    return reply.send({ success: true, action: body.action })
  })
}
