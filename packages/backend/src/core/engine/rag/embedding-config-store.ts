/* Global embedding preferences persist under the ASH config group. */
import * as fs from 'fs'
import { resolveStoragePath } from '../../../storage/path-routing'
import type { KnowledgeBaseConfig } from '../../storage/knowledge-base/store'
import { readCrossGroupBundle, transactCrossGroupBundle } from '../../../storage/cross-group-bundle'

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
const participants = () => [{ name: 'metadata', root: resolveStoragePath('config') }, { name: 'secret', root: resolveStoragePath('secrets') }]

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
  const committed = readCrossGroupBundle(participants(), 'embedding-config', (bundle) => ({ metadata: bundle.read('metadata', 'embedding-config.json'), secret: bundle.read('secret', 'embedding-api-key.json') }))
  if (committed?.metadata) return { ...fromEnv(), ...JSON.parse(committed.metadata), apiKey: committed.secret ? (JSON.parse(committed.secret) as { apiKey?: string }).apiKey : fromEnv().apiKey } as EmbeddingConfig
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

export function saveEmbeddingConfig(config: EmbeddingConfig & { clearApiKey?: boolean }): void {
  transactCrossGroupBundle(participants(), 'embedding-config', (bundle) => {
    const current = bundle.read('secret', 'embedding-api-key.json'); const previous = current ? (JSON.parse(current) as { apiKey?: string }).apiKey : readApiKey()
    const { apiKey, clearApiKey, ...preferences } = config; const nextApiKey = clearApiKey ? undefined : apiKey ?? previous
    bundle.write('metadata', 'embedding-config.json', JSON.stringify(nextApiKey ? { ...preferences, apiKeyRef: 'embedding:default' } : preferences, null, 2))
    bundle.write('secret', 'embedding-api-key.json', JSON.stringify(nextApiKey ? { apiKey: nextApiKey } : {}, null, 2))
  })
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
