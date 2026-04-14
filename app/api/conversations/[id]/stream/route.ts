/* GET /api/conversations/[id]/stream?taskId=xxx — SSE 流式输出，轮询 runner.log 并推送 */
import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { dataStore } from '@/core/workflow-engine'
import { getConversation, updateAssistantMessageByTaskId } from '@/core/conversation/store'

interface RouteContext {
  params: Promise<{ id: string }>
}

const DATA_DIR = path.join(os.homedir(), 'manta-data')

function getTaskOutputDir(taskId: string): string {
  return path.join(DATA_DIR, 'tasks', taskId)
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const taskId = req.nextUrl.searchParams.get('taskId')

  if (!taskId) {
    return new Response('taskId 参数缺失', { status: 400 })
  }

  // AI: 验证会话和任务存在
  const conv = getConversation(id)
  if (!conv) {
    return new Response('会话不存在', { status: 404 })
  }

  const encoder = new TextEncoder()

  // AI: 构造 SSE 流，轮询 runner.log 直到任务完成
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(payload))
      }

      const outputDir = getTaskOutputDir(taskId)
      const logFile = path.join(outputDir, 'runner.log')

      let lastSize = 0
      let accumulatedContent = ''
      const maxWaitMs = 60 * 60 * 1000 // AI: 最长等待 1 小时
      const startTime = Date.now()
      const pollIntervalMs = 500

      // AI: 等待 outputDir 创建（任务刚创建时可能还没 outputDir）
      let waitForDir = 0
      while (!fs.existsSync(outputDir) && waitForDir < 30000) {
        await new Promise((r) => setTimeout(r, 500))
        waitForDir += 500
      }

      send('start', { taskId })

      // AI: 轮询循环
      while (Date.now() - startTime < maxWaitMs) {
        // AI: 读取新增日志
        if (fs.existsSync(logFile)) {
          const stat = fs.statSync(logFile)
          if (stat.size > lastSize) {
            const fd = fs.openSync(logFile, 'r')
            const buf = Buffer.alloc(stat.size - lastSize)
            fs.readSync(fd, buf, 0, buf.length, lastSize)
            fs.closeSync(fd)
            const newChunk = buf.toString('utf-8')
            lastSize = stat.size
            accumulatedContent += newChunk
            send('log', { chunk: newChunk })
          }
        }

        // AI: 检查任务状态
        const task = await dataStore.getTask(taskId)
        if (!task) {
          send('error', { message: '任务不存在' })
          break
        }

        if (task.status === 'done' || task.status === 'failed') {
          // AI: 最后一次读完日志
          if (fs.existsSync(logFile)) {
            const stat = fs.statSync(logFile)
            if (stat.size > lastSize) {
              const fd = fs.openSync(logFile, 'r')
              const buf = Buffer.alloc(stat.size - lastSize)
              fs.readSync(fd, buf, 0, buf.length, lastSize)
              fs.closeSync(fd)
              const newChunk = buf.toString('utf-8')
              accumulatedContent += newChunk
              send('log', { chunk: newChunk })
            }
          }

          // AI: 读取 output.md 作为 assistant 消息内容
          const outputFile = path.join(outputDir, 'output.md')
          let finalContent = ''
          if (fs.existsSync(outputFile)) {
            finalContent = fs.readFileSync(outputFile, 'utf-8')
          } else if (accumulatedContent) {
            finalContent = accumulatedContent
          }

          // AI: 按 taskId 精确更新对应的 assistant 消息（避免多轮对话写错位置）
          if (finalContent) {
            updateAssistantMessageByTaskId(id, taskId, finalContent)
          }

          send('done', {
            taskId,
            status: task.status,
            content: finalContent,
          })
          break
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
