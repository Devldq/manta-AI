import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

interface BackendModule {
  createBackendStorageComposition(...args: any[]): Promise<any>
  startServer(...args: any[]): Promise<any>
}

const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>

/**
 * Package smoke deliberately starts at the production package.json entry.
 * It avoids UI/server side effects but verifies the actual runtime closures.
 */
async function runPackageSmoke(): Promise<void> {
  const markerPath = process.env.MANTA_PACKAGE_SMOKE_FILE
  const marker = {
    status: 'error' as 'ok' | 'error',
    entryFile: __filename,
    requireMain: require.main?.filename ?? null,
    actualEntry: /[\\/]dist[\\/]main\.js$/.test(__filename),
    backend: false,
    composition: false,
    server: false,
    routedApis: false,
    nativeSqlite: false,
    providers: { openai: false, ollama: false, anthropic: false, core: false },
    error: undefined as string | undefined,
  }
  const persistMarker = async () => {
    if (markerPath) await writeFile(markerPath, JSON.stringify(marker), 'utf8')
  }
  try {
    if (!marker.actualEntry) throw new Error(`Package smoke was not launched through dist/main.js: ${__filename}`)
    const backend = await importEsm('@manta/backend') as BackendModule
    if (typeof backend.startServer !== 'function' || typeof backend.createBackendStorageComposition !== 'function') throw new Error('Packaged backend exports are incomplete')
    marker.backend = true
    const storageHub = require('@manta/storage-hub') as typeof import('@manta/storage-hub')
    if (!markerPath) throw new Error('Package smoke marker path is required')
    const parentPath = join(dirname(markerPath), 'composition-volume')
    const root = storageHub.volumeRoot(parentPath)
    for (const group of storageHub.STORAGE_GROUP_IDS) await mkdir(join(root, group), { recursive: true })
    const now = new Date().toISOString(); const volumeId = randomUUID()
    const bootstrap = { schemaVersion: 1 as const, generation: 1, volumes: [{ id: volumeId, name: 'Smoke', parentPath, createdAt: now, updatedAt: now }], groupAssignments: Object.fromEntries(storageHub.STORAGE_GROUP_IDS.map((group) => [group, volumeId])) }
    const store = new storageHub.BootstrapStore(join(dirname(markerPath), 'ash-bootstrap.json'))
    await store.write(bootstrap as any)
    const composition = await backend.createBackendStorageComposition(store, { deferAgentRecovery: true })
    marker.composition = true
    await persistMarker()
    const server = await backend.startServer({ storage: composition.runtime, port: 0, host: '127.0.0.1', startSchedulers: false, startup: false, isDev: true })
    marker.server = true
    await persistMarker()
    const [conversations, workspaces] = await Promise.all([
      fetch(`http://127.0.0.1:${server.port}/api/conversations`),
      fetch(`http://127.0.0.1:${server.port}/api/workspaces`),
    ])
    if (!conversations.ok || !workspaces.ok) throw new Error(`Packaged routed storage APIs failed: conversations=${conversations.status}, workspaces=${workspaces.status}`)
    marker.routedApis = true
    await persistMarker()
    await server.close()
    const Database = require('better-sqlite3') as new (path: string) => { prepare(sql: string): { get(): unknown }; close(): void }
    const db = new Database(':memory:')
    db.prepare('select 1').get(); db.close()
    marker.nativeSqlite = true
    const [openai, ollama, anthropic, core] = await Promise.all([
      importEsm('@langchain/openai'), importEsm('@langchain/ollama'), importEsm('@langchain/anthropic'), importEsm('@langchain/core/messages'),
    ])
    if (typeof openai.ChatOpenAI !== 'function' || typeof ollama.ChatOllama !== 'function' || typeof anthropic.ChatAnthropic !== 'function' || typeof core.HumanMessage !== 'function') throw new Error('Packaged LangChain provider exports are incomplete')
    // Constructors are network-free and expose missing transitive runtime deps.
    new openai.ChatOpenAI({ apiKey: 'manta-package-smoke', model: 'gpt-4o-mini' })
    new ollama.ChatOllama({ baseUrl: 'http://127.0.0.1:9', model: 'manta-package-smoke' })
    new anthropic.ChatAnthropic({ apiKey: 'manta-package-smoke', model: 'claude-3-5-haiku-latest' })
    new core.HumanMessage('manta-package-smoke')
    marker.providers = { openai: true, ollama: true, anthropic: true, core: true }
    marker.status = 'ok'
  } catch (error) {
    marker.error = error instanceof Error ? error.stack ?? error.message : String(error)
  }
  await persistMarker()
  if (marker.status !== 'ok') throw new Error(marker.error ?? 'Package smoke failed')
  process.stdout.write('MANTA_PACKAGE_SMOKE_OK\n')
}

export async function runDesktop(): Promise<void> {
  const runtime = await import('./desktop-runtime')
  await runtime.runDesktop()
}

if (process.env.MANTA_PACKAGE_SMOKE === '1') {
  void runPackageSmoke().then(() => process.exit(0), (error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1) })
} else if (require.main === module) {
  void runDesktop()
}
