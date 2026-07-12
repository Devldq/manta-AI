/* Global embedding preferences persist under the ASH config group. */
import * as fs from 'fs'
import * as path from 'path'
import { resolveStoragePath } from '../../../storage/path-routing'
import type { KnowledgeBaseConfig } from '../../storage/knowledge-base/store'

type EmbeddingProvider = 'openai' | 'local'

export interface EmbeddingConfig {
  provider: EmbeddingProvider
  model: string
  baseUrl?: string
  apiKey?: string
  dimensions?: number
}

const configFile = () => resolveStoragePath('config', 'embedding-config.json')
const secretFile = () => resolveStoragePath('secrets', 'embedding-api-key.json')

function safeWrite(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

function readApiKey(): string | undefined {
  try { return (JSON.parse(fs.readFileSync(secretFile(), 'utf8')) as { apiKey?: string }).apiKey } catch { return undefined }
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
    if (fs.existsSync(configFile())) {
      const raw = fs.readFileSync(configFile(), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<EmbeddingConfig>
      if (parsed && typeof parsed === 'object') {
        return { ...fromEnv(), ...parsed, apiKey: readApiKey() ?? fromEnv().apiKey } as EmbeddingConfig
      }
    }
  } catch {
    // 读取失败则回退环境变量
  }
  return fromEnv()
}

export function saveEmbeddingConfig(config: EmbeddingConfig): void {
  const { apiKey, ...preferences } = config
  safeWrite(configFile(), apiKey ? { ...preferences, apiKeyRef: 'embedding:default' } : preferences)
  safeWrite(secretFile(), { apiKey })
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
