import { exec } from 'child_process'
import { promisify } from 'util'
import { appendJsonl, NOTIFICATIONS_FILE } from './dataStore'
import type { Notification } from './types'

const execAsync = promisify(exec)

/* AI start: Mac 系统通知插件 — 通过 osascript 推送 */

export interface NotifyOptions {
  title: string
  message: string
  taskId?: string
  agentId?: string
  type?: Notification['type']
}

export async function sendMacNotification(opts: NotifyOptions): Promise<void> {
  const { title, message } = opts
  // AI: 转义引号防止注入
  const safeTitle = title.replace(/"/g, '\\"')
  const safeMsg = message.replace(/"/g, '\\"')
  const script = `display notification "${safeMsg}" with title "${safeTitle}" sound name "Glass"`
  try {
    await execAsync(`osascript -e '${script}'`)
  } catch {
    // AI: macOS 环境不可用时静默失败，不影响主流程
    console.warn('[macNotify] osascript 执行失败，跳过通知')
  }

  // AI: 同时写入通知历史文件
  const record: Notification = {
    id: crypto.randomUUID(),
    title,
    message,
    type: opts.type ?? 'info',
    taskId: opts.taskId,
    agentId: opts.agentId,
    timestamp: new Date().toISOString(),
    read: false,
  }
  appendJsonl(NOTIFICATIONS_FILE, record)
}

/* AI end: Mac 系统通知插件 */
