import type { ToolDefinition, ToolRegistry } from '../core/tools/registry'
import type { PluginApi, PluginConfig, PluginDefinition } from './types'

interface LoadedPlugin {
  definition: PluginDefinition
  tools: string[]
}

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>()

  constructor(private readonly registry: ToolRegistry) {}

  async load(definition: PluginDefinition, config?: PluginConfig): Promise<string[]> {
    if (this.plugins.has(definition.name)) {
      throw new Error(`插件 "${definition.name}" 已加载`)
    }

    const resolvedConfig = this.resolveEnvVars({
      ...definition.config,
      ...config,
    })
    const registeredTools: string[] = []

    const api: PluginApi = {
      registerTools: (tools: ToolDefinition[]) => {
        for (const tool of tools) {
          const prefixedName = `${definition.name}__${tool.name}`
          this.registry.register({
            ...tool,
            name: prefixedName,
            description: `[Plugin:${definition.name}] ${tool.description}`,
          })
          registeredTools.push(prefixedName)
        }
      },
      getConfig: () => resolvedConfig,
      log: (message: string) => {
        console.log(`  [plugin:${definition.name}] ${message}`)
      },
    }

    try {
      await definition.activate(api)
    } catch (err) {
      for (const toolName of registeredTools) {
        this.registry.unregister(toolName)
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`插件 "${definition.name}" 激活失败: ${message}`)
    }

    this.plugins.set(definition.name, { definition, tools: registeredTools })
    return registeredTools
  }

  async unload(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name)
    if (!plugin) return false

    try {
      await plugin.definition.destroy?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`  [plugin:${name}] 卸载清理失败: ${message}`)
    }

    for (const toolName of plugin.tools) {
      this.registry.unregister(toolName)
    }
    return this.plugins.delete(name)
  }

  async unloadAll(): Promise<void> {
    for (const name of Array.from(this.plugins.keys())) {
      await this.unload(name)
    }
  }

  list(): Array<PluginDefinition & { tools: string[] }> {
    return Array.from(this.plugins.values()).map(({ definition, tools }) => ({
      ...definition,
      tools: [...tools],
    }))
  }

  private resolveEnvVars(config: PluginConfig): PluginConfig {
    const resolved: PluginConfig = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, envName) => {
          return process.env[String(envName).trim()] ?? ''
        })
      } else {
        resolved[key] = value
      }
    }
    return resolved
  }
}
