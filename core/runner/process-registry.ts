/*  start: ProcessRegistry — Agent 进程追踪与管理 */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// AI: 进程注册表文件路径
const DATA_DIR = path.join(os.homedir(), 'manta-data')
const REGISTRY_FILE = path.join(DATA_DIR, 'process-registry.json')

interface ProcessRecord {
  taskId: string
  pid: number
  agentName: string
  startedAt: string
}

// ─── ProcessRegistry 类 ───────────────────────────────────────────

/**
 * AI: 进程注册表 — 追踪每个任务启动的 agent 进程
 * - 支持一个任务关联多个进程（parallel 步骤）
 * - 提供 kill 方法强制停止进程
 * - 自动清理已结束的进程记录
 */
export class ProcessRegistry {
  private records: ProcessRecord[] = []

  constructor() {
    this.load()
  }

  // AI: 从文件加载注册表
  private load(): void {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8')
        this.records = JSON.parse(raw) as ProcessRecord[]
      }
    } catch (err) {
      console.error('[ProcessRegistry] 加载失败:', err)
      this.records = []
    }
  }

  // AI: 保存注册表到文件
  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
      const tmp = `${REGISTRY_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.records, null, 2), 'utf-8')
      fs.renameSync(tmp, REGISTRY_FILE)
    } catch (err) {
      console.error('[ProcessRegistry] 保存失败:', err)
    }
  }

  // AI: 注册任务关联的进程
  register(taskId: string, pid: number, agentName: string): void {
    this.records.push({
      taskId,
      pid,
      agentName,
      startedAt: new Date().toISOString(),
    })
    this.save()
    console.log(`[ProcessRegistry] 注册进程: taskId=${taskId}, pid=${pid}, agent=${agentName}`)
  }

  // AI: 停止任务关联的所有进程
  async kill(taskId: string): Promise<{ killed: number; failed: number }> {
    const pids = this.records.filter((r) => r.taskId === taskId).map((r) => r.pid)
    if (pids.length === 0) {
      console.log(`[ProcessRegistry] 任务 ${taskId} 无关联进程`)
      return { killed: 0, failed: 0 }
    }

    let killed = 0
    let failed = 0

    for (const pid of pids) {
      try {
        // AI: 尝试发送 SIGTERM 信号
        process.kill(pid, 'SIGTERM')
        console.log(`[ProcessRegistry] 已发送 SIGTERM 到进程 ${pid}`)
        killed++
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException
        if (error.code === 'ESRCH') {
          // AI: 进程已经不存在，视为正常
          console.log(`[ProcessRegistry] 进程 ${pid} 已不存在`)
          killed++
        } else {
          console.error(`[ProcessRegistry] 停止进程 ${pid} 失败:`, error)
          failed++
        }
      }
    }

    // AI: 清理该任务的进程记录
    this.cleanup(taskId)

    return { killed, failed }
  }

  // AI: 清理已结束的进程记录
  cleanup(taskId: string): void {
    const before = this.records.length
    this.records = this.records.filter((r) => r.taskId !== taskId)
    const after = this.records.length
    if (before !== after) {
      this.save()
      console.log(`[ProcessRegistry] 清理任务 ${taskId} 的 ${before - after} 条记录`)
    }
  }

  // AI: 检查进程是否存在
  isAlive(pid: number): boolean {
    try {
      // AI: signal 0 不发送实际信号，只检查进程是否存在
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  // AI: 清理所有已结束的进程记录（维护用）
  cleanupAll(): void {
    const before = this.records.length
    this.records = this.records.filter((r) => this.isAlive(r.pid))
    const after = this.records.length
    if (before !== after) {
      this.save()
      console.log(`[ProcessRegistry] 全局清理: 删除 ${before - after} 条无效记录`)
    }
  }

  // AI: 获取任务关联的所有进程信息（调试用）
  getTaskProcesses(taskId: string): ProcessRecord[] {
    return this.records.filter((r) => r.taskId === taskId)
  }

  // AI: 获取所有注册的进程（调试用）
  getAllProcesses(): ProcessRecord[] {
    return [...this.records]
  }
}

// AI: 全局单例
export const processRegistry = new ProcessRegistry()
/*  end: ProcessRegistry 结束 */
