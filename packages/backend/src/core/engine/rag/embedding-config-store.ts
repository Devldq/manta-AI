/* 全局 Embedding 配置持久化 — ~/.manta-data/embedding-config.json */
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { KnowledgeBaseConfig } from '../../storage/knowledge-base/store'

type EmbeddingProvider = 'openai' | 'local'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  model: string
  baseUrl?: string
  apiKey?: string
  dimensions?: number
}

const DATA_DIR = path.join(os.homedir(), '.manta-data')
const CONFIG_FILE = path.join(DATA_DIR, 'embedding-config.json')

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function safeWrite(data: unknown): void {
  ensureDir()
  const tmp = `${CONFIG_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, CONFIG_FILE)
}

function fromEnv(): EmbeddingConfig {
  const provider = (process.env.EMBEDDING_PROVIDER as EmbeddingProvider) || 'openai'
  return {
    provider,
    model: process.env.EMBEDDING_MODEL || (provider === 'local' ? 'nomic-embed-text' : 'text-embedding-3-small'),
    baseUrl: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
    dimensions: provider === 'local' ? 768 : 1536,
  }
}

export function getEmbeddingConfig(): EmbeddingConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<EmbeddingConfig>
      if (parsed && typeof parsed === 'object') {
        return { ...fromEnv(), ...parsed } as EmbeddingConfig
      }
    }
  } catch {
    // 读取失败则回退环境变量
  }
  return fromEnv()
}

export function saveEmbeddingConfig(config: EmbeddingConfig): void {
  safeWrite(config)
}

export function applyToKnowledgeBase(kbConfig: KnowledgeBaseConfig): KnowledgeBaseConfig {
  const globalCfg = getEmbeddingConfig()
  if (!kbConfig.embeddingConfig) {
    return {
      ...kbConfig,
      embeddingConfig: globalCfg,
      dimensions: kbConfig.dimensions ?? globalCfg.dimensions ?? 1536,
    }
  }
  return kbConfig
}
