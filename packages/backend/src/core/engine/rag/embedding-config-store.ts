/* Global embedding preferences persist under the ASH config group. */
import * as fs from 'fs'
import * as path from 'node:path'
import { resolveStoragePath } from '../../../storage/path-routing'
import type { KnowledgeBaseConfig } from '../../storage/knowledge-base/store'
import { withAtomicBundle } from '../../../storage/atomic-record-bundle'

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
const bundleCoordinator = () => resolveStoragePath('secrets', '.transactions', 'embedding-config')
const secretsRoot = () => resolveStoragePath('secrets')
const sealedPath = 'embedding/sealed-config.json'

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
  const sealed = withAtomicBundle(secretsRoot(), 'embedding-config', (bundle) => bundle.read(sealedPath))
  if (sealed) return { ...fromEnv(), ...JSON.parse(sealed) } as EmbeddingConfig
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
  let preferences: Omit<typeof config, 'apiKey' | 'clearApiKey'>; let nextApiKey: string | undefined
  withAtomicBundle(secretsRoot(), 'embedding-config', (bundle) => {
    const current = bundle.read(sealedPath); const previous = current ? (JSON.parse(current) as EmbeddingConfig).apiKey : readApiKey()
    const { apiKey, clearApiKey, ...rest } = config; preferences = rest; nextApiKey = clearApiKey ? undefined : apiKey ?? previous
    bundle.write(sealedPath, JSON.stringify({ ...rest, apiKey: nextApiKey }, null, 2))
  })
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(nextApiKey ? { ...preferences!, apiKeyRef: 'embedding:default' } : preferences!, null, 2))
  fs.mkdirSync(path.dirname(secretFile()), { recursive: true }); fs.writeFileSync(secretFile(), JSON.stringify(nextApiKey ? { apiKey: nextApiKey } : {}, null, 2))
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
