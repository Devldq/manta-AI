/*  start: Channel 层 — Mac 通知内置实现 + Webhook 通用实现 */
import { execSync } from 'child_process'
import type { Channel, ChannelMessage } from '../types'

// ─── Mac Notification Channel ───────────────────────────────────────────────

export class MacNotificationChannel implements Channel {
  readonly id = 'mac-notification'

  async send(message: ChannelMessage): Promise<void> {
    // AI: 使用 osascript 发送 macOS 通知
    const title = escapeAppleScript(message.title)
    const body = escapeAppleScript(message.body)

    try {
      execSync(
        `osascript -e 'display notification "${body}" with title "${title}"'`,
        { stdio: 'ignore' }
      )
    } catch {
      // AI: 通知发送失败不应中断主流程，静默处理
      console.warn('[channel:mac] 发送通知失败，可能不在 macOS 环境')
    }
  }
}

// ─── Webhook Channel ───────────────────────────────────────────────

export interface WebhookConfig {
  url: string
  type?: 'feishu' | 'slack' | 'dingtalk' | 'discord' | 'generic'
  secret?: string
  headers?: Record<string, string>
}

export class WebhookChannel implements Channel {
  readonly id = 'webhook'

  constructor(private config: WebhookConfig) {}

  async send(message: ChannelMessage): Promise<void> {
    const payload = buildPayload(this.config.type ?? 'generic', message)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.headers,
    }

    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        console.warn(`[channel:webhook] HTTP ${res.status} from ${this.config.url}`)
      }
    } catch (err) {
      console.warn('[channel:webhook] 发送 Webhook 失败:', err)
    }
  }
}

// ─── Channel 注册表 ───────────────────────────────────────────────

// AI: 全局 Channel 管理器
class ChannelManager {
  private channels = new Map<string, Channel>()

  constructor() {
    // 注册默认 Channel
    this.register(new MacNotificationChannel())
  }

  register(channel: Channel): void {
    this.channels.set(channel.id, channel)
  }

  get(id: string): Channel | null {
    return this.channels.get(id) ?? null
  }

  async sendAll(message: ChannelMessage, channelIds?: string[]): Promise<void> {
    const ids = channelIds ?? Array.from(this.channels.keys())
    await Promise.allSettled(
      ids
        .map((id) => this.channels.get(id))
        .filter(Boolean)
        .map((ch) => ch!.send(message))
    )
  }
}

export const channelManager = new ChannelManager()

// ─── 辅助函数 ───────────────────────────────────────────────

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\\''")
}

// AI: 根据 Webhook 类型构建不同的 payload 格式
function buildPayload(
  type: WebhookConfig['type'],
  message: ChannelMessage
): unknown {
  switch (type) {
    case 'feishu':
      return {
        msg_type: 'text',
        content: { text: `【Manta】${message.title}\n${message.body}` },
      }

    case 'slack':
      return {
        text: `*${message.title}*\n${message.body}`,
      }

    case 'dingtalk':
      return {
        msgtype: 'text',
        text: { content: `【Manta】${message.title}\n${message.body}` },
      }

    case 'discord':
      return {
        content: `**${message.title}**\n${message.body}`,
      }

    default:
      return { title: message.title, body: message.body, taskId: message.taskId }
  }
}
/*  end: Channel 层结束 */
