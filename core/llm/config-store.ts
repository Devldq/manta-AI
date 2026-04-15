/* LLM 配置持久化存储 — ~/manta-data/llm-config.json */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { LLMConfig } from './types'
import { getDefaultLLMConfig } from './types'

// AI: 配置文件路径
const DATA_DIR = path.join(os.homedir(), 'manta-data')
const CONFIG_FILE = path.join(DATA_DIR, 'llm-config.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

/** 读取 LLM 配置，优先级：持久化文件 > 环境变量默认值 */
export function getLLMConfig(): LLMConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const saved = JSON.parse(raw) as LLMConfig
      // AI: 合并环境变量兜底（保证字段完整性）
      const defaults = getDefaultLLMConfig()
      return {
        ...defaults,
        ...saved,
        // AI: 若存储的 apiKey 为空（被脱敏），则使用环境变量
        apiKey: saved.apiKey || defaults.apiKey,
      }
    }
  } catch {
    // 读取失败则使用默认值
  }
  return getDefaultLLMConfig()
}

/** 保存 LLM 配置到本地文件 */
export function saveLLMConfig(config: LLMConfig): void {
  ensureDir()
  const tmp = `${CONFIG_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf-8')
  fs.renameSync(tmp, CONFIG_FILE)
}

/** 返回脱敏后的配置（apiKey 只显示前4后4字符）*/
export function getLLMConfigMasked(): LLMConfig & { apiKeyMasked?: string } {
  const config = getLLMConfig()
  const masked = { ...config }
  if (config.apiKey && config.apiKey.length > 8) {
    masked.apiKey = undefined
    return {
      ...masked,
      apiKeyMasked: `${config.apiKey.slice(0, 4)}****${config.apiKey.slice(-4)}`,
    }
  }
  return { ...masked, apiKey: config.apiKey ? '****' : undefined }
}
