/**
 * Plugin 注册表 — 运行时的插件生命周期管理
 *
 * 职责：
 * - 管理所有已注册插件的运行时状态
 * - 执行生命周期钩子
 * - 依赖拓扑排序与校验
 * - 插件间通信（事件总线）
 */

import { execSync } from 'child_process'
import type {
  PluginDefinition,
  PluginHookEvent,
  PluginHook,
} from '@manta/shared'
import {
  listPlugins,
  getPlugin,
  updatePlugin,
  enablePlugin as storeEnablePlugin,
  disablePlugin as storeDisablePlugin,
  getActivePlugins,
} from './store'

// ─── 事件总线 ───────────────────────────────────────────────

type EventHandler = (data: Record<string, unknown>) => void | Promise<void>

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>()

  /** 订阅事件 */
  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  /** 取消订阅 */
  off(event: string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler)
  }

  /** 发送事件 */
  async emit(event: string, data: Record<string, unknown> = {}): Promise<void> {
    const handlers = this.listeners.get(event)
    if (!handlers) return

    const results = await Promise.allSettled(
      [...handlers].map((handler) =>
        Promise.resolve(handler(data)).catch((err) => {
          console.error(`[PluginRegistry] Event handler error (${event}):`, err)
        }),
      ),
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[PluginRegistry] Event "${event}" handler failed:`, result.reason)
      }
    }
  }
}

// ─── 插件注册表 ─────────────────────────────────────────────

class PluginRegistry {
  private eventBus = new EventBus()
  private hookStats = new Map<string, { lastRun?: string; successCount: number; failCount: number }>()

  // ═══ 事件总线 ═════════════════════════════════════════════

  /** 获取事件总线实例 */
  get events(): EventBus {
    return this.eventBus
  }

  // ═══ 生命周期管理 ═════════════════════════════════════════

  /**
   * 激活插件
   */
  async activatePlugin(pluginId: string): Promise<PluginDefinition | null> {
    const plugin = getPlugin(pluginId)
    if (!plugin) return null

    // 检查依赖
    const depsOk = this.checkDependencies(plugin)
    if (!depsOk.valid) {
      await updatePlugin(pluginId, {
        state: 'error',
      })
      console.error(
        `[PluginRegistry] Cannot activate "${plugin.manifest.name}": missing dependencies:`,
        depsOk.missing,
      )
      return null
    }

    // 执行 on-enable 钩子
    await this.executeHookForPlugin(plugin, 'on-enable')

    const updated = await storeEnablePlugin(pluginId)
    if (updated) {
      await this.eventBus.emit('plugin:activated', {
        pluginId: updated.id,
        pluginName: updated.manifest.name,
      })
    }
    return updated
  }

  /**
   * 停用插件
   */
  async deactivatePlugin(pluginId: string): Promise<PluginDefinition | null> {
    const plugin = getPlugin(pluginId)
    if (!plugin) return null

    // 检查是否有其他插件依赖此插件
    const dependents = this.getDependents(pluginId)
    if (dependents.length > 0) {
      console.warn(
        `[PluginRegistry] Plugin "${plugin.manifest.name}" is depended on by:`,
        dependents.join(', '),
      )
    }

    // 执行 on-disable 钩子
    await this.executeHookForPlugin(plugin, 'on-disable')

    const updated = await storeDisablePlugin(pluginId)
    if (updated) {
      await this.eventBus.emit('plugin:deactivated', {
        pluginId: updated.id,
        pluginName: updated.manifest.name,
      })
    }
    return updated
  }

  /**
   * 安装生命周期（安装后注册）
   */
  async onPostInstall(pluginId: string): Promise<void> {
    const plugin = getPlugin(pluginId)
    if (!plugin) return

    await this.executeHookForPlugin(plugin, 'post-install')
    await this.eventBus.emit('plugin:installed', {
      pluginId: plugin.id,
      pluginName: plugin.manifest.name,
    })
  }

  /**
   * 卸载生命周期（卸载前清理）
   */
  async onPreUninstall(pluginId: string): Promise<void> {
    const plugin = getPlugin(pluginId)
    if (!plugin) return

    await this.executeHookForPlugin(plugin, 'pre-uninstall')
  }

  /**
   * 升级生命周期
   */
  async onUpgrade(pluginId: string): Promise<void> {
    const plugin = getPlugin(pluginId)
    if (!plugin) return

    await this.executeHookForPlugin(plugin, 'on-upgrade')
    await this.eventBus.emit('plugin:upgraded', {
      pluginId: plugin.id,
      pluginName: plugin.manifest.name,
    })
  }

  // ═══ 钩子执行 ═════════════════════════════════════════════

  /**
   * 为指定插件执行特定事件的所有钩子
   */
  private async executeHookForPlugin(
    plugin: PluginDefinition,
    event: PluginHookEvent,
  ): Promise<void> {
    const hooks = plugin.manifest.hooks?.filter((h) => h.event === event)
    if (!hooks || hooks.length === 0) return

    for (const hook of hooks) {
      await this.executeSingleHook(plugin.id, hook)
    }
  }

  /**
   * 执行单个钩子命令
   */
  private async executeSingleHook(
    pluginId: string,
    hook: PluginHook,
  ): Promise<void> {
    const statKey = `${pluginId}:${hook.name}`
    const timeout = hook.timeout || 30000

    try {
      console.log(`[PluginRegistry] Executing hook "${hook.name}" (${hook.event})`)

      const result = execSync(hook.command, {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024, // 1MB
        env: {
          ...process.env,
          PLUGIN_ID: pluginId,
          HOOK_EVENT: hook.event,
          HOOK_NAME: hook.name,
        },
      })

      if (result) {
        console.log(`[PluginRegistry] Hook "${hook.name}" output:`, result.trim())
      }

      // 更新统计
      const stats = this.hookStats.get(statKey) || { successCount: 0, failCount: 0 }
      stats.successCount++
      stats.lastRun = new Date().toISOString()
      this.hookStats.set(statKey, stats)

    } catch (err: any) {
      const stats = this.hookStats.get(statKey) || { successCount: 0, failCount: 0 }
      stats.failCount++
      stats.lastRun = new Date().toISOString()
      this.hookStats.set(statKey, stats)

      const errorMsg = err.stderr || err.message || String(err)
      console.error(`[PluginRegistry] Hook "${hook.name}" failed:`, errorMsg)

      if (hook.blocking) {
        throw new Error(`阻断性钩子 "${hook.name}" 执行失败: ${errorMsg}`)
      }
    }
  }

  /**
   * 公开的钩子执行方法
   */
  async executeHook(pluginId: string, event: PluginHookEvent): Promise<void> {
    const plugin = getPlugin(pluginId)
    if (!plugin) {
      throw new Error(`插件 ${pluginId} 不存在`)
    }
    await this.executeHookForPlugin(plugin, event)
  }

  // ═══ 依赖管理 ═════════════════════════════════════════════

  /**
   * 检查插件的依赖是否满足
   */
  checkDependencies(plugin: PluginDefinition): { valid: boolean; missing: string[] } {
    const deps = plugin.manifest.dependencies
    if (!deps || deps.length === 0) return { valid: true, missing: [] }

    const activePlugins = getActivePlugins()
    const activeNames = new Set(activePlugins.map((p) => p.manifest.name))
    const missing: string[] = []

    for (const dep of deps) {
      if (!dep.required) continue // 可选依赖，跳过
      if (!activeNames.has(dep.pluginId)) {
        missing.push(dep.pluginId)
      }
    }

    return { valid: missing.length === 0, missing }
  }

  /**
   * 获取依赖此插件的所有插件（反向依赖）
   */
  getDependents(pluginId: string): string[] {
    const allPlugins = listPlugins()
    const plugin = getPlugin(pluginId)
    if (!plugin) return []

    const pluginName = plugin.manifest.name
    return allPlugins
      .filter((p) =>
        p.id !== pluginId &&
        p.enabled &&
        allPlugins.some((inner) => {
          const def = getPlugin(inner.id)
          return def?.manifest.dependencies?.some(
            (d) => d.pluginId === pluginName || d.pluginId === pluginId,
          )
        }),
      )
      .map((p) => p.name)
  }

  /**
   * 拓扑排序：确定插件的加载顺序
   */
  topologicalSort(): string[] {
    const plugins = listPlugins().filter((p) => p.enabled)
    const pluginIds = new Set(plugins.map((p) => p.id))

    // 构建邻接表（depended-on-id -> [dependents]）
    const graph = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    for (const p of plugins) {
      graph.set(p.id, [])
      inDegree.set(p.id, 0)
    }

    for (const p of plugins) {
      const def = getPlugin(p.id)
      if (!def?.manifest.dependencies) continue

      for (const dep of def.manifest.dependencies) {
        if (!dep.required) continue
        // 找到依赖的插件
        const depPlugin = plugins.find(
          (pp) => pp.name === dep.pluginId || pp.id === dep.pluginId,
        )
        if (depPlugin) {
          graph.get(depPlugin.id)?.push(p.id)
          inDegree.set(p.id, (inDegree.get(p.id) || 0) + 1)
        }
      }
    }

    // Kahn 算法
    const queue: string[] = []
    const result: string[] = []

    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      for (const neighbor of graph.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) queue.push(neighbor)
      }
    }

    // 检测循环依赖
    if (result.length < pluginIds.size) {
      console.warn(
        '[PluginRegistry] Circular dependency detected!',
        'Sorted:', result.length,
        'Total:', pluginIds.size,
      )
    }

    return result
  }

  // ═══ 统计信息 ═════════════════════════════════════════════

  getHookStats(): Map<string, { lastRun?: string; successCount: number; failCount: number }> {
    return new Map(this.hookStats)
  }

  /**
   * 获取注册表摘要
   */
  getSummary() {
    const plugins = listPlugins()
    const active = plugins.filter((p) => p.enabled)
    const errorPlugins = plugins.filter((p) => p.state === 'error')

    return {
      total: plugins.length,
      active: active.length,
      inactive: plugins.length - active.length,
      errors: errorPlugins.length,
      loadOrder: this.topologicalSort(),
      hookStats: Object.fromEntries(this.hookStats),
    }
  }
}

// ─── 单例导出 ───────────────────────────────────────────────

export const pluginRegistry = new PluginRegistry()
